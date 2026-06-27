import CryptoJS from 'crypto-js'

const iv = CryptoJS.enc.Utf8.parse('0102030405060708')
const presetKey = CryptoJS.enc.Utf8.parse('0CoJKeMQ483S9h82')
const linuxKey = CryptoJS.enc.Utf8.parse('rEcOS4SUqOCr199r')
const eapiKey = CryptoJS.enc.Utf8.parse('eNSeBpyxFlvEDZtZ')

function aesEncrypt(text, key, ivSpec) {
  const encrypted = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(text), key, {
    iv: ivSpec,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  })
  return encrypted.toString()
}

function createSecretKey(size) {
  const keys = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let key = ''
  for (let i = 0; i < size; i++) {
    key += keys.charAt(Math.floor(Math.random() * keys.length))
  }
  return key
}

function rsaEncrypt(text, modulus) {
  const rsaText = text.split('').reverse().join('')
  const hexText = rsaText.split('').map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  const bigText = BigInt('0x' + hexText)
  const bigModulus = BigInt('0x' + modulus)
  const bigExponent = BigInt('0x010001')
  
  let result = 1n
  let base = bigText % bigModulus
  let exp = bigExponent
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % bigModulus
    }
    base = (base * base) % bigModulus
    exp = exp / 2n
  }
  return result.toString(16).padStart(256, '0')
}

export function weapi(object) {
  const text = JSON.stringify(object)
  const secretKey = createSecretKey(16)
  const params1 = aesEncrypt(text, presetKey, iv)
  const params2 = aesEncrypt(params1, CryptoJS.enc.Utf8.parse(secretKey), iv)
  
  const modulus = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f5e49175f01c2137f2a2398d40'
  const encSecKey = rsaEncrypt(secretKey, modulus)
  
  return {
    params: params2,
    encSecKey
  }
}

export function eapi(url, object) {
  const text = typeof object === 'object' ? JSON.stringify(object) : object
  const message = `API!${url}!${text}`
  const digest = CryptoJS.MD5(message).toString()
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  
  const encrypted = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(data), eapiKey, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7
  })
  
  return {
    params: encrypted.ciphertext.toString().toUpperCase()
  }
}

export function linuxapi(object) {
  const text = JSON.stringify(object)
  const encrypted = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(text), linuxKey, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7
  })
  return {
    params: encrypted.ciphertext.toString().toUpperCase()
  }
}
