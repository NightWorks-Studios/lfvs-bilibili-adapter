import { Context } from '@cordisjs/client'
import BilibiliCard from './BilibiliCard.vue'
import BilibiliLoadCard from './BilibiliLoadCard.vue'

export default (ctx: Context) => {
  ctx.inject(['manager'], (ctx) => {
    ctx.client.router.slot({
      type: 'plugin-details',
      component: BilibiliCard,
      order: -100
    })
  })

  ctx.client.router.slot({
    type: 'home',
    component: BilibiliLoadCard,
    order: 900
  })
}
