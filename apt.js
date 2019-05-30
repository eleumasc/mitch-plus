"use strict";

const same = require("./same");

function treeNode(info, parent = null) {
  return {
    info: info,
    parent: parent,
    children: []
  };
}

function treeFindOrPushChild(parent, findChildFn, pushChildInfoFn) {
  let child = parent.children.find(findChildFn);
  if (!child) {
    child = treeNode(pushChildInfoFn(), parent);
    parent.children.push(child);
  }
  return child;
}

function calcPageModel(links) {
  const pageModel = treeNode({ kind: "pm" });

  for (let link of links) {
    let lastNode = pageModel;
    lastNode = treeFindOrPushChild(
      lastNode,
      child =>
        child.info.kind === "pm.dompath" &&
        same.dompath(link.dompath, child.info.dompath),
      () => ({ kind: "pm.dompath", dompath: link.dompath })
    );

    let actionElementIndex = 0;
    for (let actionElement of link.action) {
      lastNode = treeFindOrPushChild(
        lastNode,
        child =>
          child.info.kind === "pm.actionElement" &&
          child.info.index === actionElementIndex &&
          same.actionElement(actionElement, child.info.actionElement),
        () => ({
          kind: "pm.actionElement",
          index: actionElementIndex,
          actionElement: actionElement
        })
      );
      actionElementIndex++;
    }

    const linkParamsKeys = Object.keys(link.params);
    lastNode = treeFindOrPushChild(
      lastNode,
      child =>
        child.info.kind === "pm.paramsKeys" &&
        same.paramsKeys(linkParamsKeys, child.info.paramsKeys),
      () => ({ kind: "pm.paramsKeys", paramsKeys: linkParamsKeys })
    );

    lastNode = treeFindOrPushChild(
      lastNode,
      child =>
        child.info.kind === "pm.params" &&
        same.params(link.params, child.info.params),
      () => ({ kind: "pm.params", params: link.params })
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
      if (node.info.kind === "pm.dompath") {
        if (
          !pageLinkVector.dompathCollection.some(dompath =>
            same.dompath(node.info.dompath, dompath)
          )
        ) {
          pageLinkVector.dompathCollection.push(node.info.dompath);
        }
      } else if (node.info.kind === "pm.actionElement") {
        if (node.info.index == pageLinkVector.actionElementCollections.length) {
          pageLinkVector.actionElementCollections.push([]);
        }
        if (
          !pageLinkVector.actionElementCollections[node.info.index].some(
            actionElement =>
              same.actionElement(node.info.actionElement, actionElement)
          )
        ) {
          pageLinkVector.actionElementCollections[node.info.index].push(
            node.info.actionElement
          );
        }
      } else if (node.info.kind === "pm.paramsKeys") {
        if (
          !pageLinkVector.paramsKeysCollection.some(paramsKeys =>
            same.paramsKeys(node.info.paramsKeys, paramsKeys)
          )
        ) {
          pageLinkVector.paramsKeysCollection.push(node.info.paramsKeys);
        }
      } else if (node.info.kind === "pm.params") {
        if (
          !pageLinkVector.paramsCollection.some(params =>
            same.params(node.info.params, params)
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

exports.create = function() {
  return treeNode({ kind: "apt" });
};

exports.grow = function(absPageTree, links) {
  const pageModel = calcPageModel(links);
  const pageLinkVector = calcPageLinkVector(pageModel);

  let lastNode = absPageTree;

  lastNode = treeFindOrPushChild(
    lastNode,
    child =>
      child.info.kind === "apt.dompathCollection" &&
      same.collection(
        pageLinkVector.dompathCollection,
        child.info.dompathCollection,
        same.dompath
      ),
    () => ({
      kind: "apt.dompathCollection",
      dompathCollection: pageLinkVector.dompathCollection
    })
  );

  let actionElementCollectionIndex = 0;
  for (let actionElementCollection of pageLinkVector.actionElementCollections) {
    lastNode = treeFindOrPushChild(
      lastNode,
      child =>
        child.info.kind === "apt.actionElementCollection" &&
        child.info.index === actionElementCollectionIndex &&
        same.collection(
          actionElementCollection,
          child.info.actionElementCollection,
          same.actionElement
        ),
      () => ({
        kind: "apt.actionElementCollection",
        index: actionElementCollectionIndex,
        actionElementCollection: actionElementCollection
      })
    );
    actionElementCollectionIndex++;
  }

  lastNode = treeFindOrPushChild(
    lastNode,
    child =>
      child.info.kind === "apt.paramsKeysCollection" &&
      same.collection(
        pageLinkVector.paramsKeysCollection,
        child.info.paramsKeysCollection,
        same.paramsKeys
      ),
    () => ({
      kind: "apt.paramsKeysCollection",
      paramsKeysCollection: pageLinkVector.paramsKeysCollection
    })
  );

  lastNode = treeFindOrPushChild(
    lastNode,
    child =>
      child.info.kind === "apt.paramsCollection" &&
      same.collection(
        pageLinkVector.paramsCollection,
        child.info.paramsCollection,
        same.params
      ),
    () => ({
      kind: "apt.paramsCollection",
      paramsCollection: pageLinkVector.paramsCollection
    })
  );

  return lastNode;
};
