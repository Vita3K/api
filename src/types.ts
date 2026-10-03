export interface Env {
    // If you set another name in wrangler.toml as the value for 'binding',
    // replace "DB" with the variable name you defined.
    DB: D1Database;
    ACCESS_TOKEN: string | undefined;
    PASSWORD: string | undefined;
    DISABLE_CACHE: string | undefined;
}

export interface GameEntry {
    name: string;
    titleId: string;
    labels: {
        name: string;
        color: string;
    }[];
    issueId: number;
}

export interface ListInfo {
    name: string;
    owner: string;
    repo: string;
    timestamp: number;
}