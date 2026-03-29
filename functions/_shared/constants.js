/**
 * Centralized Currency Constants
 * Version: 5.0.0
 * 
 * This file is the single source of truth for:
 * 1. Twelve Data API symbols
 * 2. Country-to-Currency mapping
 * 3. Currency symbols for UI
 * 4. Emergency fallback rates (Circuit Breaker)
 */

// All USD-based pairs for Twelve Data Price API
export const TWELVE_SYMBOLS = [
  'USD/EUR', 'USD/PHP', 'USD/SGD', 'USD/JPY', 'USD/GBP',
  'USD/SAR', 'USD/AED', 'USD/QAR', 'USD/KWD', 'USD/OMR',
  'USD/BHD', 'USD/CAD', 'USD/AUD', 'USD/NZD', 'USD/CHF',
  'USD/NOK', 'USD/SEK', 'USD/HKD', 'USD/MYR', 'USD/TWD',
  'USD/KRW', 'USD/CNY', 'USD/THB', 'USD/MXN',
  'USD/IDR', 'USD/VND'
].join(',');

// Official Country to Currency Mapping
export const COUNTRY_CURRENCY_MAP = {
  'SA': 'SAR', 'AE': 'AED', 'QA': 'QAR', 'KW': 'KWD', 'OM': 'OMR', 'BH': 'BHD',
  'GB': 'GBP', 'IT': 'EUR', 'ES': 'EUR', 'DE': 'EUR', 'FR': 'EUR', 'NL': 'EUR',
  'CH': 'CHF', 'NO': 'NOK', 'SE': 'SEK', 'SG': 'SGD', 'HK': 'HKD', 'MY': 'MYR',
  'TW': 'TWD', 'JP': 'JPY', 'KR': 'KRW', 'CN': 'CNY', 'TH': 'THB', 'US': 'USD',
  'CA': 'CAD', 'MX': 'MXN', 'AU': 'AUD', 'NZ': 'NZD', 'PH': 'PHP',
  'ID': 'IDR', 'VN': 'VND'
};

// Detailed Country List for Snapshots & Analytics
export const SUPPORTED_COUNTRIES = [
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
  { code: 'QA', name: 'Qatar', currency: 'QAR' },
  { code: 'KW', name: 'Kuwait', currency: 'KWD' },
  { code: 'OM', name: 'Oman', currency: 'OMR' },
  { code: 'BH', name: 'Bahrain', currency: 'BHD' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
  { code: 'IT', name: 'Italy', currency: 'EUR' },
  { code: 'ES', name: 'Spain', currency: 'EUR' },
  { code: 'DE', name: 'Germany', currency: 'EUR' },
  { code: 'FR', name: 'France', currency: 'EUR' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR' },
  { code: 'CH', name: 'Switzerland', currency: 'CHF' },
  { code: 'NO', name: 'Norway', currency: 'NOK' },
  { code: 'SE', name: 'Sweden', currency: 'SEK' },
  { code: 'SG', name: 'Singapore', currency: 'SGD' },
  { code: 'HK', name: 'Hong Kong', currency: 'HKD' },
  { code: 'MY', name: 'Malaysia', currency: 'MYR' },
  { code: 'TW', name: 'Taiwan', currency: 'TWD' },
  { code: 'JP', name: 'Japan', currency: 'JPY' },
  { code: 'KR', name: 'South Korea', currency: 'KRW' },
  { code: 'CN', name: 'China', currency: 'CNY' },
  { code: 'TH', name: 'Thailand', currency: 'THB' },
  { code: 'US', name: 'United States', currency: 'USD' },
  { code: 'CA', name: 'Canada', currency: 'CAD' },
  { code: 'MX', name: 'Mexico', currency: 'MXN' },
  { code: 'AU', name: 'Australia', currency: 'AUD' },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD' },
  { code: 'ID', name: 'Indonesia', currency: 'IDR' },
  { code: 'VN', name: 'Vietnam', currency: 'VND' }
];


// Global Currency Symbols
export const CURRENCY_SYMBOLS = {
  'SAR': '﷼', 'AED': 'د.إ', 'QAR': '﷼', 'KWD': 'د.ك', 'OMR': '﷼', 'BHD': '.د.ب',
  'GBP': '£', 'EUR': '€', 'CHF': 'CHF', 'NOK': 'kr', 'SEK': 'kr', 'SGD': '$',
  'HKD': '$', 'MYR': 'RM', 'TWD': 'NT$', 'JPY': '¥', 'KRW': '₩', 'CNY': '¥',
  'THB': '฿', 'USD': '$', 'CAD': '$', 'MXN': '$', 'AUD': '$', 'NZD': '$', 'PHP': '₱',
  'IDR': 'Rp', 'VND': '₫'
};

// Emergency fallback rates if Twelve Data is down and D1 cache is missing
// Based on approximate USD rates
export const EMERGENCY_RATES = {
  USD: 1.00, PHP: 60.5, SGD: 1.34, JPY: 151.2, GBP: 0.79,
  SAR: 3.75, AED: 3.67, QAR: 3.64, KWD: 0.307, OMR: 0.385,
  BHD: 0.377, EUR: 0.92, CAD: 1.35, AUD: 1.51, NZD: 1.66,
  CHF: 0.90, NOK: 10.70, SEK: 10.60, HKD: 7.82, MYR: 4.73,
  TWD: 31.90, KRW: 1345, CNY: 7.23, THB: 36.50, MXN: 16.7,
  IDR: 15800, VND: 24900
};


