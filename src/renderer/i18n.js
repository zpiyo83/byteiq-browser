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

function updateUIText() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });
  
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key);
  });
}

function initI18n() {
  loadLocale(currentLocale);
  updateUIText();
}

module.exports = {
  t,
  setLocale,
  getCurrentLocale,
  initI18n
};
