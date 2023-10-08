import type { AppInterface, fiberTasks } from '@micro-app/types'
import {
  logError,
  CompletionPath,
  pureCreateElement,
  injectFiberTask,
  serialExecFiberTasks,
  isLinkElement,
  isScriptElement,
  isStyleElement,
  isImageElement,
} from '../libs/utils'
import {
  extractLinkFromHtml,
  fetchLinksFromHtml,
} from './links'
import {
  extractScriptElement,
  fetchScriptsFromHtml,
  checkExcludeUrl,
  checkIgnoreUrl,
} from './scripts'
import scopedCSS from '../sandbox/scoped_css'
import globalEnv from '../libs/global_env'

/**
 * transform html string to dom
 * @param str string dom
 */
function getWrapElement (str: string): HTMLElement { //TODO: 现在流行，创建一个标签元素，将模板放进去进行转化吗？？
  const wrapDiv = pureCreateElement('div')

  wrapDiv.innerHTML = str

  return wrapDiv
}

/**
 * Recursively process each child element
 * @param parent parent element
 * @param app app
 * @param microAppHead micro-app-head element
 */
function flatChildren (
  parent: HTMLElement,
  app: AppInterface,
  microAppHead: Element,
  fiberStyleTasks: fiberTasks,
): void {
  const children = Array.from(parent.children)

  children.length && children.forEach((child) => {
    flatChildren(child as HTMLElement, app, microAppHead, fiberStyleTasks) //TODO: 进行递归处理
  })

  for (const dom of children) {
    if (isLinkElement(dom)) {
      if (dom.hasAttribute('exclude') || checkExcludeUrl(dom.getAttribute('href'), app.name)) {
        parent.replaceChild(document.createComment('link element with exclude attribute ignored by micro-app'), dom)
      } else if (!(dom.hasAttribute('ignore') || checkIgnoreUrl(dom.getAttribute('href'), app.name))) {
        extractLinkFromHtml(dom, parent, app)
      } else if (dom.hasAttribute('href')) {
        globalEnv.rawSetAttribute.call(dom, 'href', CompletionPath(dom.getAttribute('href')!, app.url))
      }
    } else if (isStyleElement(dom)) {
      if (dom.hasAttribute('exclude')) {
        parent.replaceChild(document.createComment('style element with exclude attribute ignored by micro-app'), dom)
      } else if (app.scopecss && !dom.hasAttribute('ignore')) {
        injectFiberTask(fiberStyleTasks, () => scopedCSS(dom, app)) //TODO:如果是样式 就这样处理 css 会在这个方法里给样式添加前缀 来实现样式隔离
      }
    } else if (isScriptElement(dom)) {
      extractScriptElement(dom, parent, app)
    } else if (isImageElement(dom) && dom.hasAttribute('src')) {
      globalEnv.rawSetAttribute.call(dom, 'src', CompletionPath(dom.getAttribute('src')!, app.url))
    }
    /**
     * Don't remove meta and title, they have some special scenes
     * e.g.
     * document.querySelector('meta[name="viewport"]') // for flexible
     * document.querySelector('meta[name="baseurl"]').baseurl // for api request
     *
     * Title point to main app title, child app title used to be compatible with some special scenes
     */
    // else if (dom instanceof HTMLMetaElement || dom instanceof HTMLTitleElement) {
    //   parent.removeChild(dom)
    // }
  }
}

/**
 * Extract link and script, bind style scope
 * @param htmlStr html string
 * @param app app
 */
export function extractSourceDom (htmlStr: string, app: AppInterface): void {
  const wrapElement = getWrapElement(htmlStr)
  const microAppHead = globalEnv.rawElementQuerySelector.call(wrapElement, 'micro-app-head')
  const microAppBody = globalEnv.rawElementQuerySelector.call(wrapElement, 'micro-app-body')

  if (!microAppHead || !microAppBody) {
    const msg = `element ${microAppHead ? 'body' : 'head'} is missing`
    app.onerror(new Error(msg))
    return logError(msg, app.name)
  }

  const fiberStyleTasks: fiberTasks = app.isPrefetch || app.fiber ? [] : null

  flatChildren(wrapElement, app, microAppHead, fiberStyleTasks) //TODO: 将所有子元素进行 处理

  /**
   * Style and link are parallel, because it takes a lot of time for link to request resources. During this period, style processing can be performed to improve efficiency.
   */
  const fiberStyleResult = serialExecFiberTasks(fiberStyleTasks)

  if (app.source.links.size) {
    fetchLinksFromHtml(wrapElement, app, microAppHead, fiberStyleResult) //TODO: 处理link 标签
  } else if (fiberStyleResult) {
    fiberStyleResult.then(() => app.onLoad(wrapElement))
  } else {
    app.onLoad(wrapElement)
  }

  if (app.source.scripts.size) {
    fetchScriptsFromHtml(wrapElement, app) //TODO: 处理script标签
  } else {
    app.onLoad(wrapElement)
  }
}
