"use strict";

const apt = require("./apt");
const same = require("./same");
const util = require("util");

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
            similarPages(dstPage, link1.dstPage) &&
            // DEBUG
            ((console.log(
              "found familiar page " +
                dstPage.id +
                " (" +
                dstPage.url +
                "), looks like page " +
                link1.dstPage.id +
                " (" +
                link1.dstPage.url +
                ")"
            ) &&
              true) ||
              true)
        )
    );
  }
}

let lastLinkNumber = 0;

function mergeLinks(crawler, realLinks, page, addNew = true) {
  for (let realLink of realLinks) {
    const link = crawler.links.find(link => same.link(realLink, link));
    if (!link) {
      if (addNew) {
        const newLink = {
          ...realLink,
          id: "link-" + lastLinkNumber++,
          dstPage: null,
          visitable: true,
          visited: false,
          visitCount: 0,
          giveUpCountDown1: 50,
          giveUpCountDown2: 5
        };
        crawler.links.push(newLink);
        page.links.push(newLink);
      }
    } else {
      page.links.push(link);
    }
  }
}

let lastPageNumber = 0;

function getPageByRealLinks(crawler, realLinks, url) {
  const aptLeaf = apt.grow(crawler.absPageTree, realLinks);
  const page = aptLeaf.info.page;
  if (!page) {
    const newPage = {
      id: "page-" + lastPageNumber++,
      aptLeaf: null,
      links: [],
      url: url,
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

function skippedDirectLink(crawler, link) {
  if (--link.giveUpCountDown1 < 1) {
    link.visitable = false;
  }
  crawler.skipLinks.push(link);
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

  crawler.pathToIndirectLink.unshift(
    dstPage.links.find(link => linkIsUnvisited(link))
  );

  let page = dstPage,
    prevPage = dstPage.prev;

  while (page !== srcPage) {
    crawler.pathToIndirectLink.unshift(page.prevLink);
    page = prevPage;
    prevPage = prevPage.prev;
  }

  return crawler.pathToIndirectLink.shift();
}

function brokenPathToIndirectLink(crawler) {
  if (crawler.pathToIndirectLink.length > 0) {
    const dstLink = crawler.pathToIndirectLink.splice(-1)[0];
    if (--dstLink.giveUpCountDown2 < 1) {
      dstLink.visitable = false;
    }
  }
  crawler.pathToIndirectLink.splice(0);
}

function setLast(crawler, page, link) {
  crawler.lastPage = page;
  crawler.lastLink = link;
}

function resetLast(crawler) {
  crawler.lastPage = null;
  crawler.lastLink = null;
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

function logAndReturnSelectLink(link, ...message) {
  if (link) console.log(...message);
  return link;
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

  try {
    do {
      crawler.skipLinks.splice(0);

      let cbResult = await callback({ request: "page" });
      const realLinks = cbResult.links;
      const page = getPageByRealLinks(crawler, realLinks, cbResult.url);

      if (crawler.lastLink) {
        crawler.lastLink.visitCount++;

        if (!crawler.lastLink.visited) {
          crawler.lastLink.dstPage = page;
          crawler.lastLink.visited = true;
        } else if (crawler.lastLink.dstPage !== page) {
          console.log("[M] unexpected navigation");
          brokenPathToIndirectLink(crawler);

          if (crawler.options.dynamicLinks) {
            // DEBUG
            console.log(
              "[M] update " +
                crawler.lastLink.id +
                " (" +
                crawler.lastLink.dstPage.url +
                " -> " +
                page.url +
                ")"
            );

            crawler.lastLink.dstPage = page;
            console.log("[M] updated");
          } else {
            crawler.lastLink.visitable = false;
            resetLast(crawler);
            console.log("[M] go home 1");
            await callback({ request: "home" });
            continue;
          }
        }
      }

      let done = false;
      do {
        const link =
          logAndReturnSelectLink(
            crawler.pathToIndirectLink.shift(),
            "[M] next one is a link from path to indirect link (continue)",
            crawler.pathToIndirectLink.map(link => link.url)
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
          // DEBUG
          /*
          console.log(
            util.inspect(
              crawler.pages.map(page => ({
                id: page.id,
                url: page.url,
                dist: page.dist,
                prev: page.prev && page.prev.id,
                prevLink: page.prevLink && page.prevLink.id,
                links: page.links.map(link => ({
                  id: link.id,
                  url: link.url,
                  dstPage: link.dstPage && link.dstPage.id,
                  visitable: link.visitable,
                  visited: link.visited,
                  visitCount: link.visitCount,
                  gucd1: link.giveUpCountDown1,
                  gucd2: link.giveUpCountDown2
                }))
              })),
              { depth: 1000, showHidden: false }
            )
          ); */

          console.log("[M] no link found");
          console.log("[M] go home 2");
          await callback({ request: "home" });
          brokenPathToIndirectLink(crawler);

          if (!crawler.lastPage) {
            throw { name: "TerminateRequest" };
          }

          resetLast(crawler);
          done = true;
          continue;
        }

        const realLink = findRealLink(link, realLinks);
        if (!realLink) {
          console.log("[M] broken navigation");
          console.log("[M] go home 3");
          await callback({ request: "home" });
          brokenPathToIndirectLink(crawler);
          resetLast(crawler);
          done = true;
          continue;
        }

        console.log("[M] follow " + link.url + " " + link.type);

        cbResult = await callback({
          request: "follow",
          link: realLink
        });

        if (cbResult.reply === "done") {
          console.log("[A] followed " + link.url);
          setLast(crawler, page, link);
          done = true;
        } else if (cbResult.reply === "skip") {
          console.log("[A] skip " + link.url);
          brokenPathToIndirectLink(crawler);
          skippedDirectLink(crawler, link);
        } else if (cbResult.reply === "mark") {
          console.log("[A] mark " + link.url);
          link.visitable = false;
          brokenPathToIndirectLink(crawler);
        } else {
          throw new Error("Protocol error");
        }
      } while (!done);
    } while (crawler.links.some(link => linkIsUnvisited(link)));
  } catch (err) {
    if (err.name === "TerminateRequest") {
      // DEBUG
      /*
      console.log(
        util.inspect(
          crawler.absPageTree.children.map(dpc => {
            return {
              dpc: dpc.info.dompathCollection,
              urls: getUrlsAtLeaves(dpc)
            };

            function getUrlsAtLeaves(u) {
              if (u.children.length > 0) {
                const result = u.children.map(v => getUrlsAtLeaves(v));
                if (result.length > 0) {
                  const [first, ...rest] = result;
                  return first.concat(...rest);
                } else {
                  return [];
                }
              } else {
                return [u.info.page.url];
              }
            }
          }),
          { depth: 1000, showHidden: false }
        )
      ); */
    } else {
      throw err;
    }
  }
};
