/* GNSS 解算引擎（浏览器/Node 通用）
 * 广播星历解算与 SEU-WJY 原 Python 程序同一套数学（ICD 广播星历外推），
 * 星历选取改为按目标时刻就近；历书解算为其简化版。 */
(function (global) {
  'use strict';
  var GPS_EPOCH_MS = Date.UTC(1980, 0, 6, 0, 0, 0);
  var MU = 3.986005e14, WE = 7.2921151467e-5;

  function fnum(line, a, b) {
    var s = (line.slice(a, b) || '').trim();
    if (!s) return 0;
    var v = parseFloat(s.replace(/D/g, 'E'));
    return isNaN(v) ? 0 : v;
  }
  function utcToGpsSeconds(dateUtcMs, leap) {
    return (dateUtcMs - GPS_EPOCH_MS) / 1000 + leap;
  }
  /* 解析 RINEX 2 / RINEX 3 导航文件，只取 GPS；返回 {leap, sats:{G01:[rec]}} */
  function parseNav(text) {
    var lines = text.split(/\r?\n/);
    var leap = 18, ver = 2, i, l;
    for (i = 0; i < lines.length && i < 40; i++) {
      l = lines[i];
      if (l.indexOf('LEAP SECONDS') >= 0) { var m = l.match(/-?\d+/); if (m) leap = parseInt(m[0], 10); }
      if (l.indexOf('RINEX VERSION') >= 0) { var v = parseFloat(l.slice(0, 20)); if (!isNaN(v)) ver = v; }
    }
    i = 0;
    while (i < lines.length && lines[i].indexOf('END OF HEADER') < 0) i++;
    i++;
    var sats = {};
    function store(name, rec, vals) {
      if (vals.length < 24) return;
      rec.iode = vals[0]; rec.crs = vals[1]; rec.dn = vals[2]; rec.m0 = vals[3];
      rec.cuc = vals[4]; rec.e = vals[5]; rec.cus = vals[6]; rec.sqrta = vals[7];
      rec.toe = vals[8]; rec.cic = vals[9]; rec.om0 = vals[10]; rec.cis = vals[11];
      rec.i0 = vals[12]; rec.crc = vals[13]; rec.w = vals[14]; rec.omdot = vals[15];
      rec.idot = vals[16]; rec.week = vals[18];
      rec.toeGps = rec.week * 604800 + rec.toe;
      (sats[name] = sats[name] || []).push(rec);
    }
    if (ver >= 3) {
      var cur = null;
      function flush() { if (cur && cur.sys === 'G') store(cur.name, cur.rec, cur.vals); cur = null; }
      for (; i < lines.length; i++) {
        var line = lines[i];
        if (/^[A-Z]\d\d \d{4}/.test(line)) {
          flush();
          var ms = Date.UTC(+line.slice(4, 8), +line.slice(9, 11) - 1, +line.slice(12, 14), +line.slice(15, 17), +line.slice(18, 20), +line.slice(21, 23));
          cur = { sys: line[0], name: line.slice(0, 3), vals: [],
            rec: { epochGps: (ms - GPS_EPOCH_MS) / 1000 + leap, a0: fnum(line, 23, 42), a1: fnum(line, 42, 61), a2: fnum(line, 61, 80) } };
        } else if (cur) {
          cur.vals.push(fnum(line, 4, 23), fnum(line, 23, 42), fnum(line, 42, 61), fnum(line, 61, 80));
        }
      }
      flush();
    } else {
      for (; i < lines.length;) {
        var ln = lines[i];
        if (!ln.trim()) { i++; continue; }
        var off = ln.charAt(0) === 'G' ? 1 : 0;
        var prn = parseInt(ln.slice(0, 2 + off).replace('G', '').trim(), 10);
        if (isNaN(prn)) { i++; continue; }
        var yy = +ln.slice(3 + off, 5 + off); yy += yy < 80 ? 2000 : 1900;
        var dtMs = Date.UTC(yy, +ln.slice(6 + off, 8 + off) - 1, +ln.slice(9 + off, 11 + off), +ln.slice(12 + off, 14 + off), +ln.slice(15 + off, 17 + off), Math.floor(fnum(ln, 18 + off, 22 + off)));
        var rec2 = { epochGps: (dtMs - GPS_EPOCH_MS) / 1000 + leap, a0: fnum(ln, 22 + off, 41 + off), a1: fnum(ln, 41 + off, 60 + off), a2: fnum(ln, 60 + off, 79 + off) };
        var vals = [];
        for (var k = 1; k <= 7; k++) {
          var bl = lines[i + k] || '';
          vals.push(fnum(bl, 3, 22), fnum(bl, 22, 41), fnum(bl, 41, 60), fnum(bl, 60, 79));
        }
        i += 8;
        store('G' + (prn < 10 ? '0' : '') + prn, rec2, vals);
      }
    }
    Object.keys(sats).forEach(function (k) { sats[k].sort(function (a, b) { return a.toeGps - b.toeGps; }); });
    return { leap: leap, sats: sats };
  }
  function nearest(recs, t) {
    var best = null, bd = Infinity;
    for (var i = 0; i < recs.length; i++) { var d = Math.abs(t - recs[i].toeGps); if (d < bd) { bd = d; best = recs[i]; } }
    return best;
  }
  function wrapTk(tk) { while (tk > 302400) tk -= 604800; while (tk < -302400) tk += 604800; return tk; }
  function keplerE(M, e) {
    var E = M;
    for (var i = 0; i < 12; i++) { var En = M + e * Math.sin(E); if (Math.abs(En - E) < 1e-13) { E = En; break; } E = En; }
    return E;
  }
  /* 广播星历解算：返回 {x,y,z, clock}（米 / 秒） */
  function calcBroadcast(eph, t) {
    var A = eph.sqrta * eph.sqrta;
    var n = Math.sqrt(MU / (A * A * A)) + eph.dn;
    var tk = wrapTk(t - eph.toeGps);
    var M = eph.m0 + n * tk;
    var E = keplerE(M, eph.e);
    var nu = Math.atan2(Math.sqrt(1 - eph.e * eph.e) * Math.sin(E), Math.cos(E) - eph.e);
    var phi = nu + eph.w;
    var du = eph.cuc * Math.cos(2 * phi) + eph.cus * Math.sin(2 * phi);
    var dr = eph.crc * Math.cos(2 * phi) + eph.crs * Math.sin(2 * phi);
    var di = eph.cic * Math.cos(2 * phi) + eph.cis * Math.sin(2 * phi);
    var u = phi + du;
    var r = A * (1 - eph.e * Math.cos(E)) + dr;
    var inc = eph.i0 + eph.idot * tk + di;
    var xo = r * Math.cos(u), yo = r * Math.sin(u);
    var OM = eph.om0 + (eph.omdot - WE) * tk - WE * (eph.toeGps % 604800);
    return {
      x: xo * Math.cos(OM) - yo * Math.cos(inc) * Math.sin(OM),
      y: xo * Math.sin(OM) + yo * Math.cos(inc) * Math.cos(OM),
      z: yo * Math.sin(inc),
      clock: eph.a0 + eph.a1 * tk + eph.a2 * tk * tk
    };
  }
  /* Yuma 历书解析：返回 {G01: {...}}（只收健康卫星） */
  function parseYuma(text) {
    var sats = {};
    var parts = text.split(/\*+ Week (\d+) almanac for PRN-(\d+) \*+/);
    for (var k = 1; k + 2 < parts.length + 1 && k < parts.length - 2; k += 3) {
      var wk = +parts[k], prn = +parts[k + 1], body = parts[k + 2];
      function grab(label) {
        var m = body.match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*([+-]?[\\d.]+(?:[Ee][+-]?\\d+)?)'));
        return m ? parseFloat(m[1]) : 0;
      }
      if (grab('Health:') !== 0) continue;
      sats['G' + (prn < 10 ? '0' : '') + prn] = {
        e: grab('Eccentricity:'), toa: grab('Time of Applicability(s):'),
        i0: grab('Orbital Inclination(rad):'), omdot: grab('Rate of Right Ascen(r/s):'),
        sqrta: grab('SQRT(A)  (m 1/2):'), om0: grab('Right Ascen at Week(rad):'),
        w: grab('Argument of Perigee(rad):'), m0: grab('Mean Anom(rad):'),
        af0: grab('Clock Bias(s):'), af1: grab('Clock Drift(s/s):'),
        weekFull: wk < 1024 ? 2048 + wk : wk
      };
    }
    return sats;
  }
  /* 历书解算（简化模型）：返回 {x,y,z, clock} */
  function calcAlmanac(a, t) {
    var toaGps = a.weekFull * 604800 + a.toa;
    var tk = wrapTk(t - toaGps);
    var A = a.sqrta * a.sqrta;
    var n = Math.sqrt(MU / (A * A * A));
    var M = a.m0 + n * tk;
    var E = keplerE(M, a.e);
    var nu = Math.atan2(Math.sqrt(1 - a.e * a.e) * Math.sin(E), Math.cos(E) - a.e);
    var phi = nu + a.w;
    var r = A * (1 - a.e * Math.cos(E));
    var xo = r * Math.cos(phi), yo = r * Math.sin(phi);
    var OM = a.om0 + (a.omdot - WE) * tk - WE * a.toa;
    return {
      x: xo * Math.cos(OM) - yo * Math.cos(a.i0) * Math.sin(OM),
      y: xo * Math.sin(OM) + yo * Math.cos(a.i0) * Math.cos(OM),
      z: yo * Math.sin(a.i0),
      clock: a.af0 + a.af1 * tk
    };
  }
  /* WGS84 大地坐标 ↔ ECEF */
  var WGS_A = 6378137.0, WGS_F = 1 / 298.257223563, WGS_E2 = WGS_F * (2 - WGS_F);
  function llhToEcef(latDeg, lonDeg, h) {
    var lat = latDeg * Math.PI / 180, lon = lonDeg * Math.PI / 180;
    var N = WGS_A / Math.sqrt(1 - WGS_E2 * Math.sin(lat) * Math.sin(lat));
    return {
      x: (N + h) * Math.cos(lat) * Math.cos(lon),
      y: (N + h) * Math.cos(lat) * Math.sin(lon),
      z: (N * (1 - WGS_E2) + h) * Math.sin(lat)
    };
  }
  /* 卫星相对观察点的方位角/高度角/距离 */
  function azElRange(obsLatDeg, obsLonDeg, obsEcef, sat) {
    var lat = obsLatDeg * Math.PI / 180, lon = obsLonDeg * Math.PI / 180;
    var dx = sat.x - obsEcef.x, dy = sat.y - obsEcef.y, dz = sat.z - obsEcef.z;
    var e = -Math.sin(lon) * dx + Math.cos(lon) * dy;
    var n = -Math.sin(lat) * Math.cos(lon) * dx - Math.sin(lat) * Math.sin(lon) * dy + Math.cos(lat) * dz;
    var u = Math.cos(lat) * Math.cos(lon) * dx + Math.cos(lat) * Math.sin(lon) * dy + Math.sin(lat) * dz;
    var range = Math.sqrt(e * e + n * n + u * u);
    var az = Math.atan2(e, n) * 180 / Math.PI; if (az < 0) az += 360;
    var el = Math.asin(u / range) * 180 / Math.PI;
    return { az: az, el: el, range: range, enu: { e: e, n: n, u: u } };
  }
  /* 把数据管线的紧凑 JSON（字段数组）还原成解算用的对象 */
  function inflateNav(json) {
    var sats = {};
    Object.keys(json.sats).forEach(function (name) {
      sats[name] = json.sats[name].map(function (row) {
        var r = {};
        json.fields.forEach(function (f, i) { r[f] = row[i]; });
        return r;
      });
    });
    return { leap: json.leap, sats: sats };
  }
  function inflateAlm(json) {
    var sats = {};
    Object.keys(json.sats).forEach(function (name) {
      var r = {};
      json.fields.forEach(function (f, i) { r[f] = json.sats[name][i]; });
      sats[name] = r;
    });
    return sats;
  }
  global.GNSS = {
    inflateNav: inflateNav, inflateAlm: inflateAlm,
    parseNav: parseNav, parseYuma: parseYuma, nearest: nearest,
    calcBroadcast: calcBroadcast, calcAlmanac: calcAlmanac,
    llhToEcef: llhToEcef, azElRange: azElRange, utcToGpsSeconds: utcToGpsSeconds,
    GPS_EPOCH_MS: GPS_EPOCH_MS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.GNSS;
})(typeof window !== 'undefined' ? window : globalThis);
