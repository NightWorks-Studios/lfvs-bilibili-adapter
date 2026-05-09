import { Context, Service } from 'cordis'
import z from 'schemastery'
import {} from '@cordisjs/plugin-http'
import {} from '@cordisjs/plugin-webui'
import { createHash } from 'crypto'
import qrcode from 'qrcode-terminal'
import QRCode from 'qrcode'
import fs from 'fs'
import path from 'path'
import { generateDmParams } from './utils'
import { GenericVideoInfo, GenericVideoStat, AdapterResult, LfvsAdapter } from 'lfvs-core'

declare module '@cordisjs/plugin-webui' {
  interface Events {
    'bilibili/status'(): any
  }
}

export interface Config {
  useLisfoxProxy: boolean
}

export const Config: z<Config> = z.object({
  useLisfoxProxy: z.boolean().default(true).description('是否启用 Lisfox 代理拉取视频信息')
})

const WBI_ENCRYPT_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52
]

const LISFOX_PROXY_VIEW_API = 'http://server.lisfox.top:9003/api/proxy/view'
const NAV_API = 'https://api.bilibili.com/x/web-interface/nav'
const QRCODE_GEN_API = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate'
const QRCODE_POLL_API = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll'

export class BilibiliAdapterService extends Service implements LfvsAdapter {
  static inject = {
    http: { required: true },
    'lfvs.core': { required: true },
    logger: { required: true },
    webui: { required: false }
  }
  public platform = 'bilibili'

  private cookie: string = ''
  private csrf: string = ''
  private webId: string = ''
  private wbiKeys: { img_key: string; sub_key: string } | null = null
  private wbiKeysLastUpdate: Date | null = null
  private cookiePath: string
  private isOnline: boolean = false

  // WebUI 状态
  private _status: 'offline' | 'waiting_qr' | 'logged_in' = 'offline'
  private _qrDataUrl?: string
  private _mid?: number
  private _uname?: string

  private abortController: AbortController

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'lfvs.bilibili')
    this.abortController = new AbortController()
    this.cookiePath = path.resolve(process.cwd(), 'data/bilibili-cookie.json')

    ctx.effect(() => {
      return () => {
        this.abortController.abort()
      }
    })

    ctx.inject(['webui'], (ctx) => {
      ctx.webui.addEntry({
        path: 'lfvs-bilibili-adapter',
        base: import.meta.url,
        dev: '../client/index.ts',
        prod: '../dist/manifest.json'
      })
      ctx.webui.addListener('bilibili/status', () => this.getStatus())
    })

    Promise.resolve().then(() => {
      this.start().catch(e => {
        this.ctx.emit('lfvs/adapter-offline', this.platform, e.message || '启动失败')
        this.setStatus('offline')
      })
    })
  }

  private getStatus() {
    return {
      status: this._status,
      qrcode: this._qrDataUrl,
      mid: this._mid,
      uname: this._uname
    }
  }

  private setStatus(status: 'offline' | 'waiting_qr' | 'logged_in', extra: any = {}) {
    this._status = status
    if (extra.qrcode) this._qrDataUrl = extra.qrcode
    if (extra.mid) this._mid = extra.mid
    if (extra.uname) this._uname = extra.uname
    this.ctx.webui?.broadcast('bilibili/status-update', this.getStatus())
  }

  protected async start() {
    const dir = path.dirname(this.cookiePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    if (this.loadCookie()) {
      const navData = await this.ctx.http.get(NAV_API, { headers: { Cookie: this.cookie } })
      if (navData.code === 0 && navData.data.isLogin) {
        await this.fetchWebId(navData.data.mid.toString())
        this.setStatus('logged_in', { mid: navData.data.mid, uname: navData.data.uname })
        this.setOnline()
        return
      }
    }

    await this.loginByQRCode()
    const navData = await this.ctx.http.get(NAV_API, { headers: { Cookie: this.cookie } })
    if (navData.data?.mid) {
      await this.fetchWebId(navData.data.mid.toString())
      this.setStatus('logged_in', { mid: navData.data.mid, uname: navData.data.uname })
      this.setOnline()
    } else {
      this.setStatus('offline')
      throw new Error('登录验证失败')
    }
  }

  private setOnline() {
    this.isOnline = true
    this.ctx.get('lfvs.core').registerAdapter(this)
    this.ctx.emit('lfvs/adapter-online', this.platform)
  }

  private setOffline(reason: string) {
    if (!this.isOnline) return
    this.isOnline = false
    this.setStatus('offline')
    this.ctx.get('lfvs.core').unregisterAdapter(this.platform)
    this.ctx.emit('lfvs/adapter-offline', this.platform, reason)
  }

  protected stop() {
    this.setOffline('插件卸载')
  }

  public getCredentials() {
    return { cookie: this.cookie, csrf: this.csrf }
  }

  private async fetchWebId(mid: string) {
    const spaceUrl = `https://space.bilibili.com/${mid}`
    try {
      const html = await this.ctx.http.get(spaceUrl, {
        headers: { Cookie: this.cookie, 'User-Agent': 'Mozilla/5.0' },
        responseType: 'text'
      })
      const match = html.match(/<script id="__RENDER_DATA__"[^>]*>(.*?)<\/script>/)
      if (match && match[1]) {
        const decodedString = decodeURIComponent(match[1])
        const renderData = JSON.parse(decodedString)
        if (renderData.access_id) {
          this.webId = renderData.access_id
        }
      }
    } catch (e) {
      // ignore
    }
  }

  private async saveCookie(headers: Record<string, any> | Headers) {
    let setCookie: any
    if (typeof headers.get === 'function') {
      if (typeof (headers as any).getSetCookie === 'function') {
        setCookie = (headers as any).getSetCookie()
      } else {
        const val = headers.get('set-cookie')
        setCookie = val ? val.split(',') : undefined
      }
    } else {
      setCookie = (headers as any)['set-cookie']
    }

    if (!setCookie || (Array.isArray(setCookie) && setCookie.length === 0)) return

    const cookiesArray = Array.isArray(setCookie) ? setCookie : [setCookie]
    this.cookie = cookiesArray.map((c: string) => c.split(';')[0]).join('; ')
    const csrfMatch = this.cookie.match(/bili_jct=([^;]+)/)
    if (csrfMatch) this.csrf = csrfMatch[1]
    
    try {
      await fs.promises.writeFile(this.cookiePath, JSON.stringify({ cookie: this.cookie, csrf: this.csrf }, null, 2))
    } catch (e: any) {
      this.ctx.emit('lfvs/log', 'bilibili-adapter', 'error', `Cookie 文件保存失败: ${e.message}`)
    }
  }

  private loadCookie() {
    if (fs.existsSync(this.cookiePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.cookiePath, 'utf-8'))
        if (data.cookie && data.csrf) {
          this.cookie = data.cookie
          this.csrf = data.csrf
          return true
        }
        this.ctx.emit('lfvs/log', 'bilibili-adapter', 'warn', 'Cookie 文件内容不完整，将重新登录')
      } catch (e: any) {
        this.ctx.emit('lfvs/log', 'bilibili-adapter', 'warn', `Cookie 文件读取/解析失败: ${e.message}，将重新登录`)
      }
    }
    return false
  }

  private async loginByQRCode() {
    const gen = await this.ctx.http.get(QRCODE_GEN_API)
    if (gen.code !== 0) throw new Error(`获取二维码失败: ${gen.message}`)
    
    qrcode.generate(gen.data.url, { small: true })
    console.log('[bilibili-adapter] 请扫描上面的二维码登录Bilibili')

    const qrDataUrl = await QRCode.toDataURL(gen.data.url)
    this.setStatus('waiting_qr', { qrcode: qrDataUrl })

    return new Promise<void>((resolve, reject) => {
      if (this.abortController.signal.aborted) {
        return reject(new Error('Context disposed'))
      }

      const interval = setInterval(async () => {
        try {
          const pollResp = await this.ctx.http(QRCODE_POLL_API, { params: { qrcode_key: gen.data.qrcode_key } })
          const pollJson = await pollResp.json()
          const pollData = pollJson.data
          if (pollData && pollData.code === 0) {
            clearInterval(interval)
            await this.saveCookie(pollResp.headers)
            this.abortController.signal.removeEventListener('abort', abortHandler)
            resolve()
          } else if (pollData && pollData.code === 86038) {
            clearInterval(interval)
            this.setStatus('offline')
            this.abortController.signal.removeEventListener('abort', abortHandler)
            reject(new Error('二维码已失效'))
          }
        } catch (e) {
          clearInterval(interval)
          this.setStatus('offline')
          this.abortController.signal.removeEventListener('abort', abortHandler)
          reject(e)
        }
      }, 3000)

      const abortHandler = () => {
        clearInterval(interval)
        reject(new Error('Context disposed'))
      }

      this.abortController.signal.addEventListener('abort', abortHandler)
    })
  }

  private async getWbiKeys() {
    const now = new Date()
    if (!this.wbiKeys || !this.wbiKeysLastUpdate || this.wbiKeysLastUpdate.toDateString() !== now.toDateString()) {
      const nav = await this.ctx.http.get(NAV_API, { headers: { Cookie: this.cookie } })
      if (nav.code === 0 && nav.data?.wbi_img) {
        const img_url = nav.data.wbi_img.img_url as string
        const sub_url = nav.data.wbi_img.sub_url as string
        this.wbiKeys = {
          img_key: img_url.slice(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.')),
          sub_key: sub_url.slice(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.'))
        }
        this.wbiKeysLastUpdate = now
      } else {
        throw new Error('无法获取WBI密钥')
      }
    }
    return this.wbiKeys
  }

  private async wbiSign(params: Record<string, any>) {
    const keys = await this.getWbiKeys()
    const mixinKey = WBI_ENCRYPT_TABLE.map(n => (keys.img_key + keys.sub_key)[n]).join('').slice(0, 32)
    const signedParams: Record<string, any> = { ...params, wts: Math.round(Date.now() / 1000) }
    const query = Object.keys(signedParams).sort().map(k => {
      const v = signedParams[k]
      if (v == null) return ''
      return `${encodeURIComponent(k)}=${encodeURIComponent(v.toString().replace(/[!'()*]/g, ''))}`
    }).filter(s => s).join('&')
    const w_rid = createHash('md5').update(query + mixinKey).digest('hex')
    return `${query}&w_rid=${w_rid}`
  }

  private handleApiError(e: any, action: string, target: string, startTime: number): AdapterResult<any> {
    const costMs = Date.now() - startTime
    this.ctx.emit('lfvs/api-request', this.platform, action, target, false, costMs, e.message)
    // Check if it's an auth error (e.g., code -101 Not Logged In)
    if (e.response?.data?.code === -101) {
      this.setOffline('Cookie已失效')
    }
    return { status: 'error', message: e.message, retryable: true }
  }

  async getVideoInfoAndStats(videoId: string): Promise<AdapterResult<{ info: GenericVideoInfo; stat: GenericVideoStat }>> {
    const targetUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`
    const start = Date.now()

    if (this.config.useLisfoxProxy) {
      try {
        const lisfox = await this.ctx.http.post(LISFOX_PROXY_VIEW_API, { bvid: videoId }, { timeout: 5000 })
        if (lisfox?.response) {
          const data = this.mapBilibiliViewData(lisfox.response)
          this.ctx.emit('lfvs/api-request', this.platform, 'getVideoInfoAndStats', videoId, true, Date.now() - start)
          return { status: 'success', data }
        }
        this.ctx.emit('lfvs/api-request', this.platform, 'getVideoInfoAndStats(lisfox)', videoId, false, Date.now() - start, 'Lisfox返回数据为空')
      } catch (e: any) {
        this.ctx.emit('lfvs/api-request', this.platform, 'getVideoInfoAndStats(lisfox)', videoId, false, Date.now() - start, e.message)
      }
    }

    // 直连兜底
    try {
      const direct = await this.ctx.http.get(targetUrl, {
        headers: { Cookie: this.cookie, 'User-Agent': 'Mozilla/5.0' }
      })
      if (direct.code === 0 && direct.data) {
        const data = this.mapBilibiliViewData(direct.data)
        this.ctx.emit('lfvs/api-request', this.platform, 'getVideoInfoAndStats(local)', videoId, true, Date.now() - start)
        return { status: 'success', data }
      } else if (direct.code === -404 || direct.code === 62002 || direct.code === -403) {
        this.ctx.emit('lfvs/api-request', this.platform, 'getVideoInfoAndStats(local)', videoId, false, Date.now() - start, `code:${direct.code}`)
        return { status: 'not_found', message: `视频不可见或已被删除 (code: ${direct.code})` }
      }
      throw new Error(`直连请求异常 (code: ${direct.code}, msg: ${direct.message})`)
    } catch (e) {
      return this.handleApiError(e, 'getVideoInfoAndStats(local)', videoId, start)
    }
  }

  private mapBilibiliViewData(data: any): { info: GenericVideoInfo; stat: GenericVideoStat } {
    const arc = data.arc || data
    const owner = data.owner || arc.author || arc.owner
    const stat = data.stat || arc.stat
    return {
      info: {
        platform: 'bilibili',
        videoId: data.bvid || arc.bvid,
        title: data.title || arc.title,
        pic: data.pic || arc.pic,
        pubdate: new Date((data.pubdate || arc.pubdate) * 1000),
        uploader: { uid: owner.mid.toString(), name: owner.name }
      },
      stat: {
        view: stat.view,
        danmaku: stat.danmaku,
        reply: stat.reply,
        favorite: stat.favorite || stat.fav || 0,
        coin: stat.coin,
        share: stat.share,
        like: stat.like
      }
    }
  }

  async getUploaderRecentVideos(mid: string): Promise<AdapterResult<GenericVideoInfo[]>> {
    const start = Date.now()
    try {
      const params = {
        mid, ps: 30, tid: 0, pn: 1, keyword: '', order: 'pubdate',
        platform: 'web', web_location: 1550101, order_avoided: true,
        ...generateDmParams(), w_webid: this.webId, csrf: this.csrf
      }
      const query = await this.wbiSign(params)
      const res = await this.ctx.http.get(`https://api.bilibili.com/x/space/wbi/arc/search?${query}`, {
        headers: { Cookie: this.cookie, 'User-Agent': 'Mozilla/5.0' }
      })
      if (res.code === 0 && res.data?.list?.vlist) {
        const videos = res.data.list.vlist.map((v: any) => ({
          platform: 'bilibili',
          videoId: v.bvid,
          title: v.title,
          pic: v.pic,
          pubdate: new Date(v.created * 1000),
          uploader: { uid: mid, name: v.author }
        }))
        this.ctx.emit('lfvs/api-request', this.platform, 'getUploaderRecentVideos', mid, true, Date.now() - start)
        return { status: 'success', data: videos }
      } else if (res.code === -404 || res.code === -400) {
        this.ctx.emit('lfvs/api-request', this.platform, 'getUploaderRecentVideos', mid, false, Date.now() - start, `code:${res.code}`)
        return { status: 'not_found', message: `UP主不存在 (code: ${res.code})` }
      }
      throw new Error(res.message || `请求失败 code: ${res.code}`)
    } catch (e) {
      return this.handleApiError(e, 'getUploaderRecentVideos', mid, start)
    }
  }

  async getUploaderInfo(mid: string): Promise<AdapterResult<{ uid: string; name: string; avatar?: string }>> {
    const start = Date.now()
    try {
      const params = { mid, wts: Math.round(Date.now() / 1000) }
      const query = await this.wbiSign(params) // simplified sign
      const res = await this.ctx.http.get(`https://api.bilibili.com/x/space/wbi/acc/info?${query}`, {
        headers: { Cookie: this.cookie, 'User-Agent': 'Mozilla/5.0' }
      })
      if (res.code === 0 && res.data) {
        this.ctx.emit('lfvs/api-request', this.platform, 'getUploaderInfo', mid, true, Date.now() - start)
        return { status: 'success', data: { uid: mid, name: res.data.name, avatar: res.data.face } }
      } else if (res.code === -404) {
        this.ctx.emit('lfvs/api-request', this.platform, 'getUploaderInfo', mid, false, Date.now() - start, `code:${res.code}`)
        return { status: 'not_found', message: '用户不存在' }
      }
      throw new Error(res.message || `请求失败 code: ${res.code}`)
    } catch (e) {
      return this.handleApiError(e, 'getUploaderInfo', mid, start)
    }
  }
}

export const apply = (ctx: Context, config: Config) => {
  ctx.plugin(BilibiliAdapterService, config)
}
