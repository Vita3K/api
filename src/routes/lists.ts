import { Env, ListInfo } from '../types';

export default async function (env: Env, req: Request, _match: URLPatternResult) {
    if (req.method != 'GET') {
        return Response.json('Method not allowed', {
            status: 405
        });
    }

    const listInfosResult = await env.DB.prepare('SELECT * FROM list_info').run<ListInfo>();
    const listInfos = listInfosResult.results;

    const output: any = [];
    listInfos.forEach(list => {
        output.push({ ...list });
    });

    return Response.json(output, {
        status: 200, headers: {
            'content-type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
        }
    })

}
