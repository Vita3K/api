import { Env } from '../types';

export default async function (env: Env, req: Request, match: URLPatternResult): Promise<Response> {
    if (req.method != 'GET') {
        return Response.json('Method not allowed', { status: 405 });
    }

    const response = await env.DB.prepare('SELECT `response` FROM firmware').first<string>('response');

    if (!response || response.length == 0) {
        const now = new Date();
        const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
        const retryAfterHttpDate = nextHour.toUTCString();
        const retryAfter = retryAfterHttpDate;

        return Response.json(`XML data is empty, try again at the start of the hour (${retryAfter.toString()})`, {
            status: 503,
            headers: {
                'content-type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Retry-After': retryAfter.toString()
            }
        })
    }

    return new Response(response, {
        status: 200, headers: {
            'content-type': 'application/xml; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
