"use strict";

const apt = require("./apt");
const same = require("./same");

function similarPages(page1, page2) {
  let lastNode1 = page1.aptLeaf;
  while (
    lastNode1.info.kind !== "apt.actionElementCollection" ||
    !(lastNode1.info.index && lastNode1.info.index === 0)
  ) {
    lastNode1 = lastNode1.parent;
  }

  let lastNode2 = page2.aptLeaf;
  while (
    lastNode2.info.kind !== "apt.actionElementCollection" ||
    !(lastNode2.info.index && lastNode2.info.index === 0)
  ) {
    lastNode2 = lastNode2.parent;
  }

  return lastNode1 === lastNode2;
}

function pageLooksFamiliar(history, dstPage) {
  const dstPageVisit = history.find(visit => dstPage === visit.dstPage);
  return (
    !!dstPageVisit &&
    history.some(
      visit =>
        dstPage !== visit.dstPage &&
        similarPages(dstPageVisit.srcPage, visit.srcPage) &&
        same.dompath(dstPageVisit.absLink.dompath, visit.absLink.dompath) &&
        similarPages(dstPageVisit.dstPage, visit.dstPage)
    )
  );
}

function mergeAbstractLinks(absLinks, links, page) {
  for (let link of links) {
    let absLink = absLinks.find(absLink => same.link(link, absLink));
    if (!absLink) {
      absLink = {
        ...link,
        history: [],
        visitable: true
      };
      absLinks.push(absLink);
    }
    page.absLinks.push(absLink);
  }
}

function setHistoryVars(crawler, page, absLink) {
  crawler.lastPage = page;
  crawler.lastAbsLink = absLink;
  crawler.ignoreAbsLinks.push(absLink);
}

function updateHistory(crawler, dstPage) {
  if (!crawler.lastPage) return;

  const visit = {
    srcPage: crawler.lastPage,
    absLink: crawler.lastAbsLink,
    dstPage: dstPage
  };

  crawler.history.push(visit);

  crawler.lastAbsLink.history.push(visit);

  crawler.lastPage = null;
  crawler.lastAbsLink = null;
  crawler.ignoreAbsLinks.splice(0);
}

function getPage(crawler, links) {
  const aptLeaf = apt.grow(crawler.absPageTree, links);

  let page = aptLeaf.info.page;

  if (!page) {
    page = {
      aptLeaf: aptLeaf,
      absLinks: []
    };
    aptLeaf.info.page = page;
    crawler.pages.push(page);

    if (!pageLooksFamiliar(crawler.history, page)) {
      mergeAbstractLinks(crawler.absLinks, links, page);
    }
  }

  return page;
}

function isAbstractLinkUnvisited(absLink) {
  return absLink.visitable && absLink.history.length === 0;
}

function selectNextIndirectAbstractLink(crawler, srcPage) {
  // See: https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm

  const V = crawler.pages.map(page => ({
    page: page,
    dist: page !== srcPage ? Infinity : 0,
    prev: null,
    absLink: null
  }));

  const Q = V.slice();

  while (Q.length > 0) {
    const u = Q.reduce(
      (acc, cur) => (acc ? (cur.dist < acc.dist ? cur : acc) : cur),
      null
    );

    Q.splice(Q.indexOf(u), 1);

    for (let absLink of u.page.absLinks) {
      const lastVisit = absLink.history[absLink.history.length - 1];
      if (!!lastVisit) {
        const v = V.find(v => lastVisit.dstPage === v.page);
        const uvLength = absLink.history.length;
        const alt = u.dist + uvLength;
        if (alt < v.dist) {
          v.dist = alt;
          v.prev = u;
          v.absLink = lastVisit.absLink;
        }
      }
    }
  }

  let s = V.reduce(
    (acc, cur) =>
      cur.dist > 0 && cur.dist < Infinity
        ? acc
          ? cur.dist < acc.dist
            ? cur
            : acc
          : cur
        : acc,
    null
  );

  if (!s) return null;

  let t = V.find(t => s.prev.page === t.page);

  while (t.page !== srcPage) {
    s = t;
    t = V.find(t => s.prev.page === t.page);
  }

  return s.absLink;
}

function selectNextAbstractLink(crawler, page) {
  let absLink = page.absLinks.find(
    absLink =>
      isAbstractLinkUnvisited(absLink) &&
      !crawler.ignoreAbsLinks.some(absLink1 => same.link(absLink, absLink1))
  );

  if (
    !absLink &&
    page.absLinks.some(
      absLink =>
        absLink.visitable &&
        !crawler.ignoreAbsLinks.some(absLink1 => same.link(absLink, absLink1))
    )
  ) {
    absLink = selectNextIndirectAbstractLink(crawler, page);
  }

  return absLink;
}

function resolveAbstractLink(absLink, links) {
  return links.find(link => same.link(absLink, link));
}

exports.create = function() {
  return {
    absPageTree: apt.create(),
    pages: [],
    absLinks: [],
    history: [],
    lastPage: null,
    lastAbsLink: null,
    ignoreAbsLinks: []
  };
};

exports.thereAreUnvisitedLinks = function(crawler) {
  return crawler.absLinks.some(absLink => isAbstractLinkUnvisited(absLink));
};

exports.selectNextLink = function(crawler, links, pageChanged = true) {
  const page = pageChanged ? getPage(crawler, links) : lastPage;
  if (pageChanged) {
    updateHistory(crawler, page);
  }
  const absLink = selectNextAbstractLink(crawler, page);
  if (!absLink) {
    return null;
  }
  setHistoryVars(crawler, page, absLink);
  return resolveAbstractLink(absLink, links);
};

exports.markLastLinkAsUnvisitable = function(crawler) {
  if (
    !crawler.lastAbsLink.visitable ||
    crawler.lastAbsLink.history.length === 0
  ) {
    crawler.lastAbsLink.visitable = false;
  } else {
    throw new Error(
      "Unable to mark the last selected link as unvisitable: it had been visited in the past"
    );
  }
};
