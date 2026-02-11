const Store = require('electron-store');
const fs = require('fs');
const path = require('path');

const store = new Store();
let currentLocale = store.get('settings.language', 'zh-CN');
let translations = {};

function loadLocale(locale) {
  const localePath = path.join(__dirname, 'locales', `${locale}.json`);
  try {
    const data = fs.readFileSync(localePath, 'utf8');
    translations = JSON.parse(data);
    currentLocale = locale;
    store.set('settings.language', locale);
    return true;
  } catch (error) {
    console.error(`Failed to load locale ${locale}:`, error);
    return false;
  }
}

function t(key, params = {}) {
  const keys = key.split('.');
  let value = translations;
  
  for (const k of keys) {
    value = value[k];
    if (value === undefined) return key;
  }
  
  if (typeof value === 'string') {
    return value.replace(/\{(\w+)\}/g, (match, param) => params[param] || match);
  }
  
  return value;
}

function setLocale(locale) {
  if (loadLocale(locale)) {
    updateUIText();
  }
}

function getCurrentLocale() {
  return currentLocale;
}

function updateUIText(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translation = t(key);
    
    // 如果元素内包含 SVG，则只在没有 SVG 的情况下更新 textContent
    // 或者，如果翻译后的内容与当前内容不同且不是 key 本身
    if (el.querySelector('svg')) {
      // 保持 SVG，只更新 title（如果存在）
      if (el.hasAttribute('data-i18n-title')) {
        el.title = t(el.getAttribute('data-i18n-title'));
      }
    } else {
      el.textContent = translation;
    }
  });
  
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });
  
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key);
  });
}

function initI18n(root = document) {
  if (root === document) {
    loadLocale(currentLocale);
  }
  updateUIText(root);
}

module.exports = {
  t,
  setLocale,
  getCurrentLocale,
  initI18n
};
