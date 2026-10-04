import { Env } from '../types';

export default async function (env: Env, req: Request, match: URLPatternResult): Promise<Response> {
    if (req.method != 'GET') {
        return Response.json('Method not allowed', { status: 405 });
    }

    const response = await env.DB.prepare('SELECT `response` FROM firmware').first<string>('response');

    return new Response(response, {
        status: 200, headers: {
            'content-type': 'application/xml; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
