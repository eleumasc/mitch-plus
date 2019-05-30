"use strict";

exports.domain = function(urlString1, urlString2) {
  const url1 = new URL(urlString1),
    url2 = new URL(urlString2);
  return url1.protocol === url2.protocol && url1.host === url2.host;
};

exports.url = function(urlString1, urlString2) {
  const url1 = new URL(urlString1),
    url2 = new URL(urlString2);
  return (
    url1.protocol === url2.protocol &&
    url1.host === url2.host &&
    url1.pathname === url2.pathname &&
    Array.from(url1.searchParams.entries()).every(
      ([key, value]) =>
        url2.searchParams.has(key) && url2.searchParams.get(key) === value
    )
  );
};

exports.dompath = function(d1, d2) {
  return d1.length === d2.length && d1.every((_, i) => d1[i] === d2[i]);
};

exports.action = function(a1, a2) {
  return a1.length === a2.length && a1.every((_, i) => a1[i] === a2[i]);
};

exports.actionElement = function(ae1, ae2) {
  return ae1 === ae2;
};

exports.paramsKeys = function(pks1, pks2) {
  return pks1.length === pks2.length && pks1.every(pk1 => pks2.includes(pk1));
};

exports.params = function(ps1, ps2) {
  for (key in ps1) {
    if (
      ps1.hasOwnProperty(key) &&
      !(ps2.hasOwnProperty(key) && ps1[key] === ps2[key])
    ) {
      return false;
    }
  }
  for (key in ps2) {
    if (ps2.hasOwnProperty(key) && !ps1.hasOwnProperty(key)) {
      return false;
    }
  }
  return true;
};

exports.link = function(l1, l2) {
  return (
    exports.dompath(l1.dompath, l2.dompath) &&
    exports.action(l1.action, l2.action) &&
    exports.params(l1.params, l2.params)
  );
};

exports.collection = function(c1, c2, sameFn) {
  return c1.length === c2.length && c1.every(a => c2.some(b => sameFn(a, b)));
};
