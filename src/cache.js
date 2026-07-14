/**
 * 本地缓存工具 — Stale-While-Revalidate 模式
 * 先从 localStorage 读缓存秒开，后台请求最新数据，到了再静默更新
 */

const PREFIX = 'cz_cache_'

/**
 * 读取缓存
 * @param {string} key 缓存键
 * @param {number} ttl 有效期（毫秒），0 表示不过期
 * @returns {object|null} { data, stale } — stale=true 表示已过期但仍返回旧数据
 */
export function getCached(key, ttl = 0) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    const age = Date.now() - ts
    if (ttl > 0 && age > ttl) {
      return { data, stale: true }
    }
    return { data, stale: false }
  } catch {
    return null
  }
}

/**
 * 写入缓存
 * @param {string} key 缓存键
 * @param {*} data 任意可序列化数据
 */
export function setCached(key, data) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, ts: Date.now() }))
  } catch {
    // localStorage 满了或不可用，静默失败
  }
}

/**
 * 失效缓存（删除指定键）
 * @param {string} key 缓存键
 */
export function invalidate(key) {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {}
}

/**
 * 批量失效缓存
 * @param {string[]} keys 缓存键数组
 */
export function invalidateMany(keys) {
  keys.forEach(k => invalidate(k))
}

// ===== TTL 常量（毫秒） =====
export const TTL = {
  PRODUCTS: 30 * 60 * 1000,      // 产品列表 30 分钟
  IMAGE_URLS: 1 * 60 * 60 * 1000, // 图片 URL 映射 1 小时（临时链接有效期约2h，留安全余量）
  DASHBOARD: 5 * 60 * 1000,       // 仪表盘统计 5 分钟
  QUOTATIONS: 10 * 60 * 1000,     // 报价单列表 10 分钟
  AUTH: 30 * 60 * 1000,           // 登录态 30 分钟
}

// ===== 缓存键常量 =====
export const CACHE_KEY = {
  PRODUCTS: 'products',
  IMAGE_URLS: 'image_urls',
  DASHBOARD: 'dashboard',
  QUOTATIONS: 'quotations',
  AUTH: 'auth_state',
}
