"use strict";

const apt = require("./apt");
const same = require("./same");

function similarPages(page1, page2) {
  let lastNode1 = page1.aptLeaf;
  while (lastNode1.info.kind !== "apt.dompathCollection") {
    lastNode1 = lastNode1.parent;
  }
  let lastNode2 = page2.aptLeaf;
  while (lastNode2.info.kind !== "apt.dompathCollection") {
    lastNode2 = lastNode2.parent;
  }
  return lastNode1 === lastNode2;
}

function pageLooksFamiliar(crawler, dstPage) {
  if (!crawler.lastPage) {
    return false;
  } else {
    const srcPage = crawler.lastPage;
    const link = crawler.lastLink;
    return crawler.pages.some(
      srcPage1 =>
        similarPages(srcPage, srcPage1) &&
        srcPage1.links.some(
          link1 =>
            link1.visited &&
            dstPage !== link1.dstPage &&
            same.dompath(link.dompath, link1.dompath) &&
            similarPages(dstPage, link1.dstPage)
        )
    );
  }
}

function mergeLinks(crawler, realLinks, page, addNew = true) {
  for (let realLink of realLinks) {
    const link = crawler.links.find(link => same.link(realLink, link));
    if (!link) {
      if (addNew) {
        const newLink = {
          ...realLink,
          dstPage: null,
          visitable: true,
          visited: false,
          visitCount: 0
        };
        crawler.links.push(newLink);
        page.links.push(newLink);
      }
    } else {
      page.links.push(link);
    }
  }
}

function getPageByRealLinks(crawler, realLinks) {
  const aptLeaf = apt.grow(crawler.absPageTree, realLinks);
  const page = aptLeaf.info.page;
  if (!page) {
    const newPage = {
      aptLeaf: null,
      links: [],
      dist: Infinity,
      prev: null,
      prevLink: null
    };
    newPage.aptLeaf = aptLeaf;
    aptLeaf.info.page = newPage;
    crawler.pages.push(newPage);
    mergeLinks(
      crawler,
      realLinks,
      newPage,
      !pageLooksFamiliar(crawler, newPage)
    );
    return newPage;
  }
  return page;
}

function linkIsUnvisited(link) {
  return link.visitable && !link.visited;
}

function linkIsSkipped(crawler, link) {
  return crawler.skipLinks.some(link1 => same.link(link, link1));
}

function findDirectLink(crawler, page) {
  return page.links.find(
    link => linkIsUnvisited(link) && !linkIsSkipped(crawler, link)
  );
}

function findPathToIndirectLink(crawler, srcPage) {
  // See: https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm

  for (let page of crawler.pages) {
    page.dist = Infinity;
    page.prev = null;
    page.prevLink = null;
  }
  srcPage.dist = 0;

  const Q = crawler.pages.slice();

  while (Q.length > 0) {
    const page = Q.reduce(
      (page, page1) => (page ? (page1.dist < page.dist ? page1 : page) : page1),
      null
    );

    Q.splice(Q.indexOf(page), 1);

    for (let link of page.links) {
      if (link.visitable && link.visited) {
        const nextPage = link.dstPage;
        if (page.dist + link.visitCount < nextPage.dist) {
          nextPage.dist = page.dist + link.visitCount;
          nextPage.prev = page;
          nextPage.prevLink = link;
        }
      }
    }
  }

  const dstPage = crawler.pages.reduce(
    (dstPage, page) =>
      page.dist > 0 &&
      page.dist < Infinity &&
      page.links.some(link => linkIsUnvisited(link))
        ? dstPage
          ? page.dist < dstPage.dist
            ? page
            : dstPage
          : page
        : dstPage,
    null
  );

  if (!dstPage) return null;

  let page = dstPage,
    prevPage = dstPage.prev;

  while (page !== srcPage) {
    crawler.pathToIndirectLink.unshift(page.prevLink);
    page = prevPage;
    prevPage = prevPage.prev;
  }

  return crawler.pathToIndirectLink.shift();
}

function findRealLink(link, realLinks) {
  return realLinks.find(link1 => same.link(link, link1));
}

function normalizeOptions(options) {
  return {
    dynamicLinks:
      options && typeof options.dynamicLinks === "boolean"
        ? options.dynamicLinks
        : false
  };
}

exports.crawl = async function(callback, options) {
  const crawler = {
    options: normalizeOptions(options),
    absPageTree: apt.create(),
    pages: [],
    links: [],
    pathToIndirectLink: [],
    skipLinks: [],
    lastPage: null,
    lastLink: null
  };

  do {
    crawler.skipLinks.splice(0);

    const realLinks = (await callback({ request: "page" })).links;
    const page = getPageByRealLinks(crawler, realLinks);

    if (!!crawler.lastLink) {
      crawler.lastLink.visitCount++;
      if (!crawler.lastLink.dstPage) {
        crawler.lastLink.dstPage = page;
        crawler.lastLink.visited = true;
      } else if (crawler.lastLink.dstPage !== page) {
        console.log("[M] unexpected navigation");
        crawler.pathToIndirectLink.splice(0);
        if (crawler.options.dynamicLinks) {
          console.log("[M] updated");
          crawler.lastLink.dstPage = page;
        } else {
          console.log("[M] go home");
          await callback({ request: "home" });
          crawler.lastPage = null;
          crawler.lastLink.visitable = false;
          crawler.lastLink = null;
          continue;
        }
      }
    }

    function logAndReturnSelectLink(link, ...message) {
      if (!!link) console.log(...message);
      return link;
    }

    let done = false;
    do {
      const link =
        logAndReturnSelectLink(
          crawler.pathToIndirectLink.shift(),
          "[M] next one is a link from path to indirect link (continue)"
        ) ||
        logAndReturnSelectLink(
          findDirectLink(crawler, page),
          "[M] next one is a direct link"
        ) ||
        logAndReturnSelectLink(
          findPathToIndirectLink(crawler, page),
          "[M] next one is a link from path to indirect link",
          crawler.pathToIndirectLink.map(link => link.url)
        );

      if (!link) {
        console.log("[M] no link found");
        console.log("[M] go home");

        await callback({ request: "home" });
        crawler.pathToIndirectLink.splice(0);
        crawler.lastPage = null;
        crawler.lastLink = null;
        done = true;
        continue;
      }

      const realLink = findRealLink(link, realLinks);
      if (!realLink) {
        console.log("[M] broken navigation");
        console.log("[M] go home");

        await callback({ request: "home" });
        crawler.pathToIndirectLink.splice(0);
        crawler.lastPage = null;
        crawler.lastLink = null;
        done = true;
        continue;
      }

      console.log("[M] follow " + link.url);

      const cbResult = await callback({
        request: "follow",
        link: realLink
      });

      if (cbResult.reply === "done") {
        console.log("[A] followed " + link.url);
        crawler.lastPage = page;
        crawler.lastLink = link;
        done = true;
      } else if (cbResult.reply === "skip") {
        console.log("[A] skip " + link.url);
        crawler.pathToIndirectLink.splice(0);
        crawler.skipLinks.push(link);
      } else if (cbResult.reply === "mark") {
        console.log("[A] mark " + link.url);
        link.visitable = false;
        crawler.pathToIndirectLink.splice(0);
      } else if (cbResult.reply === "terminate") {
        console.log("[A] terminate");
        console.log("[M] goodbye");
        return;
      } else {
        throw new Error("Protocol error");
      }
    } while (!done);
  } while (crawler.links.some(link => linkIsUnvisited(link)));
};
