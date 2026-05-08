import { Context, Service } from 'cordis';
import z from 'schemastery';
import { GenericVideoInfo, GenericVideoStat, AdapterResult, LfvsAdapter } from 'lfvs-core';
declare module '@cordisjs/plugin-webui' {
    interface Events {
        'bilibili/status'(): any;
    }
}
export interface Config {
    useLisfoxProxy: boolean;
}
export declare const Config: z<Config>;
export declare class BilibiliAdapterService extends Service implements LfvsAdapter {
    config: Config;
    static inject: {
        http: {
            required: boolean;
        };
        'lfvs.core': {
            required: boolean;
        };
        logger: {
            required: boolean;
        };
        webui: {
            required: boolean;
        };
    };
    platform: string;
    private cookie;
    private csrf;
    private webId;
    private wbiKeys;
    private wbiKeysLastUpdate;
    private cookiePath;
    private isOnline;
    private _status;
    private _qrDataUrl?;
    private _mid?;
    private _uname?;
    private abortController;
    constructor(ctx: Context, config: Config);
    private getStatus;
    private setStatus;
    protected start(): Promise<void>;
    private setOnline;
    private setOffline;
    getCredentials(): {
        cookie: string;
        csrf: string;
    };
    private fetchWebId;
    private saveCookie;
    private loadCookie;
    private loginByQRCode;
    private getWbiKeys;
    private wbiSign;
    private handleApiError;
    getVideoInfoAndStats(videoId: string): Promise<AdapterResult<{
        info: GenericVideoInfo;
        stat: GenericVideoStat;
    }>>;
    private mapBilibiliViewData;
    getUploaderRecentVideos(mid: string): Promise<AdapterResult<GenericVideoInfo[]>>;
    getUploaderInfo(mid: string): Promise<AdapterResult<{
        uid: string;
        name: string;
        avatar?: string;
    }>>;
}
export declare const apply: (ctx: Context, config: Config) => void;
