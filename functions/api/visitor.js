/* GET /api/visitor
 * 返回访客的大致地理信息（Cloudflare 在请求里自带，IP 库精度为城市级）。
 * 公告「访客检测版」用：国家/地区/城市/经纬度/时区。不落盘、不记录。
 */
export async function onRequestGet({ request }) {
  const cf = request.cf || {};
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  return Response.json(
    {
      country: cf.country || '',
      region: cf.region || '',
      city: cf.city || '',
      latitude: num(cf.latitude),
      longitude: num(cf.longitude),
      timezone: cf.timezone || '',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
