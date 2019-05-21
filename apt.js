function treeCreateNode(nodeInfo) {
  return Object.defineProperty(
    {
      info: nodeInfo,
      children: []
    },
    "parent",
    {
      enumerable: false,
      value: null
    }
  );
}

function treeFindOrPushChild(parent, findFn, childInfoFn) {
  let child = parent.children.find(findFn);
  if (!child) {
    child = treeCreateNode(childInfoFn());
    child.parent = parent;
    parent.children.push(child);
  }
  return child;
}

function sameDompath(d1, d2) {
  return d1.length === d2.length && d1.every((_, i) => d1[i] === d2[i]);
}

function sameActionElement(ae1, ae2) {
  return ae1 === ae2;
}

function sameParamsKeys(pks1, pks2) {
  return pks1.length === pks2.length && pks1.every(pk1 => pks2.includes(pk1));
}

function sameParams(ps1, ps2) {
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
}

function calcPageModel(links) {
  const pageModel = treeCreateNode(
    Object.defineProperty({ kind: "pmRoot" }, "links", {
      enumerable: false,
      value: links
    })
  );
  for (let link of links) {
    let lastNode = pageModel;
    lastNode = treeFindOrPushChild(
      lastNode,
      child =>
        child.info.kind === "dompath" &&
        sameDompath(link.dompath, child.info.dompath),
      () => ({
        kind: "dompath",
        dompath: link.dompath
      })
    );
    let actionElementIndex = 0;
    for (let actionElement of link.action) {
      lastNode = treeFindOrPushChild(
        lastNode,
        child =>
          child.info.kind === "actionElement" &&
          sameActionElement(actionElement, child.info.actionElement),
        () => ({
          kind: "actionElement",
          actionElementIndex: actionElementIndex++,
          actionElement: actionElement
        })
      );
    }
    const linkParamsKeys = Object.keys(link.params);
    lastNode = treeFindOrPushChild(
      lastNode,
      child =>
        child.info.kind === "paramsKeys" &&
        sameParamsKeys(linkParamsKeys, child.info.paramsKeys),
      () => ({
        kind: "paramsKeys",
        paramsKeys: linkParamsKeys
      })
    );
    lastNode = treeFindOrPushChild(
      lastNode,
      child =>
        child.info.kind === "params" &&
        sameParams(link.params, child.info.params),
      () =>
        Object.defineProperty(
          {
            kind: "params",
            params: link.params
          },
          "link",
          {
            enumerable: false,
            value: link
          }
        )
    );
  }
  return pageModel;
}

function calcPageLinkVector(pageModel) {
  const pageLinkVector = {
    dompathCollection: [],
    actionElementCollections: [],
    paramsKeysCollection: [],
    paramsCollection: []
  };
  const bfsQueue = [pageModel.children];
  while (bfsQueue.length > 0) {
    let nodes = bfsQueue.shift();
    for (let node of nodes) {
      bfsQueue.push(node.children);
      if (node.info.kind === "dompath") {
        if (
          !pageLinkVector.dompathCollection.some(dompath =>
            sameDompath(node.info.dompath, dompath)
          )
        ) {
          pageLinkVector.dompathCollection.push(node.info.dompath);
        }
      } else if (node.info.kind === "actionElement") {
        if (
          node.info.actionElementIndex ==
          pageLinkVector.actionElementCollections.length
        ) {
          pageLinkVector.actionElementCollections.push([]);
        }
        if (
          !pageLinkVector.actionElementCollections[
            node.info.actionElementIndex
          ].some(actionElement =>
            sameActionElement(node.info.actionElement, actionElement)
          )
        ) {
          pageLinkVector.actionElementCollections[
            node.info.actionElementIndex
          ].push(node.info.actionElement);
        }
      } else if (node.info.kind === "paramsKeys") {
        if (
          !pageLinkVector.paramsKeysCollection.some(paramsKeys =>
            sameParamsKeys(node.info.paramsKeys, paramsKeys)
          )
        ) {
          pageLinkVector.paramsKeysCollection.push(node.info.paramsKeys);
        }
      } else if (node.info.kind === "params") {
        if (
          !pageLinkVector.paramsCollection.some(params =>
            sameParams(node.info.params, params)
          )
        ) {
          pageLinkVector.paramsCollection.push(node.info.params);
        }
      } else {
        throw "Unknown kind of node"; // It should never occur!
      }
    }
  }
  return pageLinkVector;
}

function initAbstractPageTree() {
  return treeCreateNode({
    kind: "aptRoot"
  });
}

function sameCollection(c1, c2, sameFn) {
  return c1.length === c2.length && c1.every(a => c2.some(b => sameFn(a, b)));
}

function storePageLinkVectorInAbstractPageTree(
  abstractPageTree,
  pageLinkVector
) {
  let lastNode = abstractPageTree;
  lastNode = treeFindOrPushChild(
    lastNode,
    child =>
      child.info.kind === "dompathCollection" &&
      sameCollection(
        pageLinkVector.dompathCollection,
        child.info.dompathCollection,
        sameDompath
      ),
    () => ({
      kind: "dompathCollection",
      dompathCollection: pageLinkVector.dompathCollection
    })
  );
  let actionElementCollectionIndex = 0;
  for (let actionElementCollection of pageLinkVector.actionElementCollections) {
    lastNode = treeFindOrPushChild(
      lastNode,
      child =>
        child.info.kind === "actionElementCollection" &&
        sameCollection(
          actionElementCollection,
          child.info.actionElementCollection,
          sameActionElement
        ),
      () => ({
        kind: "actionElementCollection",
        actionElementCollectionIndex: actionElementCollectionIndex++,
        actionElementCollection: actionElementCollection
      })
    );
  }
  lastNode = treeFindOrPushChild(
    lastNode,
    child =>
      child.info.kind === "paramsKeysCollection" &&
      sameCollection(
        pageLinkVector.paramsKeysCollection,
        child.info.paramsKeysCollection,
        sameParamsKeys
      ),
    () => ({
      kind: "paramsKeysCollection",
      paramsKeysCollection: pageLinkVector.paramsKeysCollection
    })
  );
  lastNode = treeFindOrPushChild(
    lastNode,
    child =>
      child.info.kind === "paramsCollection" &&
      sameCollection(
        pageLinkVector.paramsCollection,
        child.info.paramsCollection,
        sameParams
      ),
    () => ({
      kind: "paramsCollection",
      paramsCollection: pageLinkVector.paramsCollection
    })
  );
  return lastNode; // Returns the node that refers to the page (which is the last one)
}

module.exports = {
  treeCreateNode: treeCreateNode,
  treeFindOrPushChild: treeFindOrPushChild,
  sameDompath: sameDompath,
  sameActionElement: sameActionElement,
  sameParamsKeys: sameParamsKeys,
  sameParams: sameParams,
  calcPageModel: calcPageModel,
  calcPageLinkVector: calcPageLinkVector,
  initAbstractPageTree: initAbstractPageTree,
  sameCollection: sameCollection,
  storePageLinkVectorInAbstractPageTree: storePageLinkVectorInAbstractPageTree
};
