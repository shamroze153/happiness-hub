/**
 * ====================================================================================
 *  HAPPINESS HUB — BACKEND (Google Apps Script)
 * ====================================================================================
 *  Single Apps Script project deployed as a Web App. Every read/write is a GET
 *  request of the form ?action=xxx&key=value (see API CONTRACT in the build brief),
 *  with the single exception of `uploadFile`, which arrives as a text/plain POST
 *  containing a JSON body (to avoid CORS preflight).
 *
 *  doGet(e) and doPost(e) both funnel into handleRequest(e), which merges
 *  e.parameter with the JSON-parsed e.postData.contents (if present) into one
 *  `p` object before routing to an action handler.
 *
 *  SETUP:
 *    1. Paste this entire file into the Apps Script project attached to the
 *       Happiness Hub Google Sheet (Extensions > Apps Script).
 *    2. Run `setupSheets` once from the editor (Run > setupSheets). Approve the
 *       permissions prompt (Advanced > Go to project (unsafe) > Allow) if shown.
 *       This is idempotent — safe to re-run any time, never duplicates rows/cols.
 *    3. Deploy > Manage deployments > pencil icon > New version > Deploy.
 *       This preserves the existing /exec URL. Do NOT create a brand-new
 *       deployment unless you intend to change the URL (and update hh.js).
 * ====================================================================================
 */

// ====================================================================================
// 0. CONFIG
// ====================================================================================

const SHEET_ID = '1NhJ6GobyokHQRsgWA-_BOuIKJyUJ81a-vH8QMr-P1w4';
const DRIVE_FOLDER_ID = '1I-Kdz4gglxD-7A__SLNE4YH2grDMohep';
const SESSION_SECRET = 'hh_secret_2025';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB

const PAYMENT_METHODS = ['Zelle', 'CashApp', 'Venmo', 'PayPal'];
const ORDER_STATUSES = [
  'Pending', 'Ordered', 'Delivered', 'Cashback Sent',
  'Rejected', 'Need More Info', 'PayPal Issue'
];
const ACTIVE_ORDER_STATUSES = ['Pending', 'Ordered', 'Delivered', 'Need More Info', 'PayPal Issue'];

// ====================================================================================
// 1. SHEET SCHEMA (column headers — used by setupSheets() to non-destructively
//    ensure every sheet has the columns the app needs)
// ====================================================================================

const HEADERS = {
  Products: [
    'product_id', 'title', 'link', 'cashback_amount', 'image_url', 'sold_by',
    'policy', 'category', 'description', 'deadline', 'tags', 'featured',
    'stock_status', 'instructions', 'badge_text', 'status', 'created_at', 'seller_id'
  ],
  Orders: [
    'order_id', 'buyer_name', 'buyer_email', 'product_id', 'product_title', 'sold_by',
    'order_number', 'keyword', 'keyword_screenshot_url', 'screenshot_url',
    'price_screenshot_url', 'payment_method', 'payment_id',
    'delivery_screenshot_url', 'delivery_image_url', 'notes', 'agent_id', 'seller_id', 'status',
    'cashback_amount', 'cashback_proof_url', 'seller_notes', 'submitted_at', 'updated_at'
  ],
  Agents: [
    'agent_id', 'name', 'password', 'email', 'whatsapp', 'commission_rate',
    'total_orders', 'total_commission', 'status', 'created_at'
  ],
  Sellers: [
    'seller_id', 'name', 'password', 'email', 'whatsapp', 'store_name', 'status', 'created_at'
  ],
  Settings: ['key', 'value'],
  Activity_Logs: ['log_id', 'timestamp', 'actor_id', 'actor_type', 'action', 'details']
};

const DEFAULT_SETTINGS = {
  site_name: 'Happiness Hub',
  hero_title: 'Shop. Snap a proof. Get cash back.',
  hero_subtitle: 'Buy the products you already want through our links, upload your receipt, and we send real money back to your Zelle, Cash App, Venmo, or PayPal — no account needed.',
  primary_color: '#7c6aff',
  whatsapp_support: '+1 (000) 000-0000',
  currency: 'USD',
  currency_symbol: '$'
};

// ====================================================================================
// 2. ENTRY POINTS
// ====================================================================================

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

/**
 * Merges query parameters with a JSON POST body (if present) and routes to the
 * correct action handler. Every handler returns a plain object which gets
 * serialized to JSON. Any uncaught error anywhere becomes
 * {success:false, error:"<message>"} so the frontend never sees a raw 500/blank page.
 */
function handleRequest(e) {
  let p = {};
  try {
    e = e || {};
    if (e.parameter) {
      for (const k in e.parameter) p[k] = e.parameter[k];
    }
    if (e.postData && e.postData.contents) {
      try {
        const body = JSON.parse(e.postData.contents);
        for (const k in body) p[k] = body[k];
      } catch (parseErr) {
        // Not JSON (or empty) — ignore, fall back to query params only.
      }
    }

    const action = p.action;
    let result;

    switch (action) {
      // ---- Public / buyer-facing ----
      case 'getProducts': result = getProducts(p); break;
      case 'getProduct': result = getProduct(p); break;
      case 'trackOrder': result = trackOrder(p); break;
      case 'getBuyerOrders': result = getBuyerOrders(p); break;
      case 'getSettings': result = getSettings(p); break;
      case 'submitOrder': result = submitOrder(p); break;
      case 'submitDeliveryProof': result = submitDeliveryProof(p); break;

      // ---- Agent ----
      case 'agentLogin': result = agentLogin(p); break;
      case 'getAgentOrders': result = getAgentOrders(p); break;

      // ---- Seller ----
      case 'sellerLogin': result = sellerLogin(p); break;
      case 'getSellerOrders': result = getSellerOrders(p); break;
      case 'updateOrderStatus': result = updateOrderStatus(p); break;

      // ---- Admin ----
      case 'getAdminDashboard': result = getAdminDashboard(p); break;
      case 'addProduct': result = addProduct(p); break;
      case 'updateProduct': result = updateProduct(p); break;
      case 'deleteProduct': result = deleteProduct(p); break;
      case 'addAgent': result = addAgent(p); break;
      case 'updateAgent': result = updateAgent(p); break;
      case 'addSeller': result = addSeller(p); break;
      case 'getAgents': result = getAgents(p); break;
      case 'getSellers': result = getSellers(p); break;
      case 'getAllOrders': result = getAllOrders(p); break;

      // ---- Files ----
      case 'uploadFile': result = uploadFile(p); break;

      // ---- Maintenance ----
      case 'setupSheets': result = setupSheets(); break;

      default:
        result = { success: false, error: 'Unknown action: ' + (action || '(none provided)') };
    }

    return jsonOutput(result);
  } catch (err) {
    return jsonOutput({ success: false, error: 'Server error: ' + (err && err.message ? err.message : String(err)) });
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ====================================================================================
// 3. SHEET HELPERS (resilient I/O — see build brief §2.6)
// ====================================================================================

/**
 * Opens a sheet by name, auto-creating it (with the correct header row from
 * HEADERS) if it doesn't exist yet.
 */
function getSheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    const headers = HEADERS[name] || [];
    if (headers.length) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  return sheet;
}

/**
 * Converts a sheet's data rows into an array of plain objects keyed by the
 * (trimmed) header row. Skips fully-empty rows. Date cells are normalized to
 * ISO strings so JSON.stringify produces a stable, comparable timestamp.
 */
function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(function (h) { return String(h).trim(); });
  const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    let isEmpty = true;
    for (let j = 0; j < row.length; j++) {
      if (row[j] !== '' && row[j] !== null && row[j] !== undefined) { isEmpty = false; break; }
    }
    if (isEmpty) continue;

    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      let val = row[j];
      if (val instanceof Date) val = val.toISOString();
      obj[headers[j]] = val === null || val === undefined ? '' : val;
    }
    result.push(obj);
  }
  return result;
}

/**
 * Appends a new row built from `dataObj`, ordering values to match the
 * sheet's ACTUAL header row (so column reordering/extension never breaks it).
 * Any header not present in dataObj gets an empty string.
 */
function appendRowByHeaders(sheet, dataObj) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });

  if (headers.length === 1 && headers[0] === '') {
    // Sheet has no header row at all yet — derive one from the keys we have.
    headers = Object.keys(dataObj);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  const row = headers.map(function (h) {
    const v = dataObj[h];
    return (v === undefined || v === null) ? '' : v;
  });
  sheet.appendRow(row);
}

/**
 * Updates a single cell identified by header name (not a hardcoded column
 * index), so the schema can be extended without breaking existing writes.
 * If the header doesn't exist yet, it's appended as a new column first.
 */
function setCellByHeader(sheet, rowIndex, headerName, value) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  let colIndex = headers.indexOf(headerName);
  if (colIndex === -1) {
    colIndex = lastCol; // 0-indexed position of the new column
    sheet.getRange(1, colIndex + 1).setValue(headerName);
  }
  sheet.getRange(rowIndex, colIndex + 1).setValue(value === undefined || value === null ? '' : value);
}

/**
 * Finds the 1-indexed sheet row number whose value in `colIndex` (1-indexed
 * column) matches `value`, using the trimmed-string comparison required by
 * build brief §2.4. Returns -1 if not found.
 */
function findRowIndex(sheet, colIndex, value) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const colValues = sheet.getRange(2, colIndex, lastRow - 1, 1).getValues();
  const target = String(value).trim();
  for (let i = 0; i < colValues.length; i++) {
    if (String(colValues[i][0]).trim() === target) {
      return i + 2; // +2: 1-indexed, plus header row
    }
  }
  return -1;
}

/**
 * Idempotent setup/upgrade routine. Safe to run repeatedly:
 *  - Creates any missing sheets (with full headers).
 *  - Adds any missing columns to existing sheets WITHOUT touching existing data.
 *  - Seeds default Settings rows only for keys that don't already exist.
 * Never deletes or overwrites existing rows/columns.
 */
function setupSheets() {
  const createdSheets = [];
  const addedColumns = {};

  Object.keys(HEADERS).forEach(function (name) {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName(name);
    const headers = HEADERS[name];

    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      createdSheets.push(name);
      return;
    }

    const lastCol = sheet.getLastColumn();
    let existingHeaders = [];
    if (lastCol > 0) {
      existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    }

    const isBlankHeaderRow = existingHeaders.length === 0 ||
      (existingHeaders.length === 1 && existingHeaders[0] === '') ||
      existingHeaders.every(function (h) { return h === ''; });

    if (isBlankHeaderRow) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      return;
    }

    const missing = headers.filter(function (h) { return existingHeaders.indexOf(h) === -1; });
    if (missing.length) {
      sheet.getRange(1, existingHeaders.length + 1, 1, missing.length).setValues([missing]);
      addedColumns[name] = missing;
    }
  });

  seedDefaultSettings();

  const message = 'Setup complete' +
    (createdSheets.length ? '. Created sheets: ' + createdSheets.join(', ') : '') +
    (Object.keys(addedColumns).length ? '. Added columns: ' + JSON.stringify(addedColumns) : '');

  Logger.log(message);
  return { success: true, message: message };
}

function seedDefaultSettings() {
  const sheet = getSheet('Settings');
  const existing = sheetToObjects(sheet);
  const existingKeys = existing.map(function (r) { return String(r.key).trim(); });

  Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
    if (existingKeys.indexOf(key) === -1) {
      appendRowByHeaders(sheet, { key: key, value: DEFAULT_SETTINGS[key] });
    }
  });
}

// ====================================================================================
// 4. UTILITIES
// ====================================================================================

/** Returns null if all fields are present & non-empty, else a human-readable error. */
function requireFields(p, fields) {
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (p[f] === undefined || p[f] === null || String(p[f]).trim() === '') {
      return 'Missing required field: ' + f;
    }
  }
  return null;
}

function generateId(prefix) {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, '0'); // 3 chars
  return prefix + ts + rand;
}

function nowIso() {
  return new Date().toISOString();
}

function hashPassword(password) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password), Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    const v = (b < 0) ? b + 256 : b;
    const hex = v.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function makeToken(actorId, actorType) {
  return Utilities.base64Encode(actorId + ':' + actorType + ':' + SESSION_SECRET);
}

function toNumber(v, fallback) {
  const n = parseFloat(v);
  return isNaN(n) ? (fallback === undefined ? 0 : fallback) : n;
}

function safeDate(v) {
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Logs a mutating action to Activity_Logs. Wrapped so a logging failure can
 * NEVER break the primary action it's attached to (build brief §3 Activity_Logs).
 */
function logActivity(actorId, actorType, action, details) {
  try {
    const sheet = getSheet('Activity_Logs');
    appendRowByHeaders(sheet, {
      log_id: generateId('LOG-'),
      timestamp: nowIso(),
      actor_id: actorId || '',
      actor_type: actorType || '',
      action: action || '',
      details: JSON.stringify(details || {})
    });
  } catch (e) {
    // Intentionally swallowed — logging must never break the main action.
  }
}

/** Removes sensitive/internal fields before sending an order to a buyer. */
function sanitizeOrderPublic(o) {
  return {
    order_id: o.order_id,
    product_id: o.product_id,
    product_title: o.product_title,
    sold_by: o.sold_by,
    status: o.status,
    cashback_amount: o.cashback_amount,
    payment_method: o.payment_method,
    order_number: o.order_number,
    keyword: o.keyword,
    keyword_screenshot_url: o.keyword_screenshot_url,
    screenshot_url: o.screenshot_url,
    price_screenshot_url: o.price_screenshot_url,
    delivery_screenshot_url: o.delivery_screenshot_url,
    delivery_image_url: o.delivery_image_url,
    cashback_proof_url: o.cashback_proof_url,
    seller_notes: o.seller_notes,
    notes: o.notes,
    submitted_at: o.submitted_at,
    updated_at: o.updated_at
  };
}

function stripPassword(obj) {
  const copy = {};
  for (const k in obj) {
    if (k !== 'password') copy[k] = obj[k];
  }
  return copy;
}

// ====================================================================================
// 5. PUBLIC / BUYER ACTIONS
// ====================================================================================

/**
 * action=getProducts  params: category?, q?
 * Returns active products only, featured first then newest, plus the list of
 * distinct categories across ALL active products (for the category chip bar).
 */
function getProducts(p) {
  const rows = sheetToObjects(getSheet('Products'));
  const allActive = rows.filter(function (r) { return String(r.status).trim() === 'Active'; });

  const categories = [];
  allActive.forEach(function (r) {
    const c = String(r.category || '').trim();
    if (c && categories.indexOf(c) === -1) categories.push(c);
  });

  let products = allActive;

  if (p.category) {
    const wantCat = String(p.category).trim().toLowerCase();
    products = products.filter(function (r) { return String(r.category || '').trim().toLowerCase() === wantCat; });
  }

  if (p.q) {
    const q = String(p.q).trim().toLowerCase();
    products = products.filter(function (r) {
      const haystack = [r.title, r.description, r.tags, r.category, r.sold_by]
        .map(function (x) { return String(x || '').toLowerCase(); })
        .join(' ');
      return haystack.indexOf(q) !== -1;
    });
  }

  products = products.slice().sort(function (a, b) {
    const fa = String(a.featured).trim().toUpperCase() === 'TRUE' ? 1 : 0;
    const fb = String(b.featured).trim().toUpperCase() === 'TRUE' ? 1 : 0;
    if (fa !== fb) return fb - fa;
    const da = safeDate(a.created_at);
    const db = safeDate(b.created_at);
    if (da && db) return db - da;
    return 0;
  });

  return { success: true, products: products, categories: categories, total: products.length };
}

/** action=getProduct  params: id */
function getProduct(p) {
  const err = requireFields(p, ['id']);
  if (err) return { success: false, error: err };

  const rows = sheetToObjects(getSheet('Products'));
  const product = rows.find(function (r) { return String(r.product_id).trim() === String(p.id).trim(); });

  if (!product) return { success: false, error: 'Product not found' };
  if (String(product.status).trim() === 'Deleted') return { success: false, error: 'Product not found' };

  return { success: true, product: product };
}

/**
 * action=trackOrder  params: email? OR order_id?
 * Public lookup — returns only sanitized fields (no payment_id / account details).
 */
function trackOrder(p) {
  if ((!p.email || !String(p.email).trim()) && (!p.order_id || !String(p.order_id).trim())) {
    return { success: false, error: 'Enter your email or an Order ID to track your order.' };
  }

  const rows = sheetToObjects(getSheet('Orders'));
  let matches;

  if (p.order_id && String(p.order_id).trim()) {
    const target = String(p.order_id).trim();
    matches = rows.filter(function (r) { return String(r.order_id).trim() === target; });
  } else {
    const target = String(p.email).trim().toLowerCase();
    matches = rows.filter(function (r) { return String(r.buyer_email).trim().toLowerCase() === target; });
  }

  if (!matches.length) {
    return { success: false, error: 'No order found. Double-check your email or Order ID and try again.' };
  }

  const orders = matches
    .map(sanitizeOrderPublic)
    .sort(function (a, b) {
      const da = safeDate(a.submitted_at), db = safeDate(b.submitted_at);
      if (da && db) return db - da;
      return 0;
    });

  return { success: true, orders: orders };
}

/**
 * action=getBuyerOrders  params: email
 * Full order history for "My Orders", plus stats including needs_delivery_proof.
 */
function getBuyerOrders(p) {
  const err = requireFields(p, ['email']);
  if (err) return { success: false, error: err };

  const target = String(p.email).trim().toLowerCase();
  const rows = sheetToObjects(getSheet('Orders'));
  const orders = rows
    .filter(function (r) { return String(r.buyer_email).trim().toLowerCase() === target; })
    .sort(function (a, b) {
      const da = safeDate(a.submitted_at), db = safeDate(b.submitted_at);
      if (da && db) return db - da;
      return 0;
    });

  const stats = {
    total: orders.length,
    in_progress: orders.filter(function (o) {
      return ['Cashback Sent', 'Rejected'].indexOf(String(o.status).trim()) === -1;
    }).length,
    cashback_received: orders.filter(function (o) { return String(o.status).trim() === 'Cashback Sent'; }).length,
    needs_delivery_proof: orders.filter(function (o) {
      const st = String(o.status).trim();
      return (st === 'Pending' || st === 'Ordered') && !String(o.delivery_screenshot_url || '').trim();
    }).length
  };

  return { success: true, orders: orders, stats: stats };
}

/** action=getSettings */
function getSettings(p) {
  const rows = sheetToObjects(getSheet('Settings'));
  const settings = {};
  rows.forEach(function (r) {
    const k = String(r.key || '').trim();
    if (k) settings[k] = r.value;
  });
  // Fill in any defaults that are still missing (e.g. brand-new sheet, setup not yet run)
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
    if (settings[k] === undefined || settings[k] === '') settings[k] = DEFAULT_SETTINGS[k];
  });
  return { success: true, settings: settings };
}

/**
 * action=submitOrder
 * params: product_id (required). All others optional:
 *   buyer_name, buyer_email, order_number, keyword, keyword_screenshot_url,
 *   screenshot_url, price_screenshot_url, payment_method, payment_id,
 *   notes, agent_id
 * If payment_method is provided, payment_id (account details) becomes required.
 */
function submitOrder(p) {
  const err = requireFields(p, ['product_id']);
  if (err) return { success: false, error: err };

  if (p.payment_method !== undefined && String(p.payment_method).trim() !== '') {
    if (PAYMENT_METHODS.indexOf(p.payment_method) === -1) {
      return { success: false, error: 'Invalid payment method. Choose one of: ' + PAYMENT_METHODS.join(', ') };
    }
    if (!p.payment_id || !String(p.payment_id).trim()) {
      return { success: false, error: 'Please enter your account details for the selected refund method.' };
    }
  }

  const productResult = getProduct({ id: p.product_id });
  if (!productResult.success) {
    return { success: false, error: 'We could not find that product, so the order was not submitted.' };
  }
  const product = productResult.product;

  const now = nowIso();
  const order = {
    order_id: generateId('ORD-'),
    buyer_name: p.buyer_name ? String(p.buyer_name).trim() : '',
    buyer_email: p.buyer_email ? String(p.buyer_email).trim() : '',
    product_id: String(p.product_id).trim(),
    product_title: product.title,
    sold_by: product.sold_by || '',
    order_number: p.order_number ? String(p.order_number).trim() : '',
    keyword: p.keyword ? String(p.keyword).trim() : '',
    keyword_screenshot_url: p.keyword_screenshot_url || '',
    screenshot_url: p.screenshot_url || '',
    price_screenshot_url: p.price_screenshot_url || '',
    payment_method: p.payment_method || '',
    payment_id: p.payment_id || '',
    delivery_screenshot_url: '',
    delivery_image_url: '',
    notes: p.notes || '',
    agent_id: p.agent_id || '',
    seller_id: product.seller_id || '',
    status: 'Pending',
    cashback_amount: product.cashback_amount,
    cashback_proof_url: '',
    seller_notes: '',
    submitted_at: now,
    updated_at: now
  };

  appendRowByHeaders(getSheet('Orders'), order);
  logActivity(p.agent_id || order.buyer_email || 'guest', p.agent_id ? 'agent' : 'buyer', 'submitOrder', {
    order_id: order.order_id, product_id: order.product_id, buyer_email: order.buyer_email
  });

  return { success: true, order_id: order.order_id, order: order };
}

/**
 * action=submitDeliveryProof  params: order_id, delivery_screenshot_url, delivery_image_url?
 * Auto-advances Pending/Ordered -> Delivered.
 */
function submitDeliveryProof(p) {
  const err = requireFields(p, ['order_id', 'delivery_screenshot_url']);
  if (err) return { success: false, error: err };

  const sheet = getSheet('Orders');
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });

  const idCol = headers.indexOf('order_id');
  if (idCol === -1) return { success: false, error: 'Orders sheet is missing the order_id column.' };

  const rowIndex = findRowIndex(sheet, idCol + 1, p.order_id);
  if (rowIndex === -1) return { success: false, error: 'Order not found.' };

  setCellByHeader(sheet, rowIndex, 'delivery_screenshot_url', p.delivery_screenshot_url);
  if (p.delivery_image_url !== undefined && String(p.delivery_image_url).trim() !== '') {
    setCellByHeader(sheet, rowIndex, 'delivery_image_url', p.delivery_image_url);
  }

  const statusCol = headers.indexOf('status');
  const currentStatus = statusCol !== -1
    ? String(sheet.getRange(rowIndex, statusCol + 1).getValue()).trim()
    : '';

  if (currentStatus === 'Pending' || currentStatus === 'Ordered') {
    setCellByHeader(sheet, rowIndex, 'status', 'Delivered');
  }
  setCellByHeader(sheet, rowIndex, 'updated_at', nowIso());

  logActivity(p.order_id, 'buyer', 'submitDeliveryProof', { order_id: p.order_id });

  return { success: true, message: 'Delivery proof received. Thanks!' };
}

// ====================================================================================
// 6. AGENT ACTIONS
// ====================================================================================

/** action=agentLogin  params: agent_id, password */
function agentLogin(p) {
  const err = requireFields(p, ['agent_id', 'password']);
  if (err) return { success: false, error: err };

  const rows = sheetToObjects(getSheet('Agents'));
  const target = String(p.agent_id).trim();
  const agent = rows.find(function (r) { return String(r.agent_id).trim() === target; });

  if (!agent) return { success: false, error: 'Invalid agent ID or password.' };
  if (String(agent.status).trim() !== 'Active') {
    return { success: false, error: 'This agent account is disabled. Please contact support.' };
  }
  if (String(agent.password || '').trim() !== hashPassword(p.password)) {
    return { success: false, error: 'Invalid agent ID or password.' };
  }

  return {
    success: true,
    token: makeToken(agent.agent_id, 'agent'),
    actor: stripPassword(agent)
  };
}

/** action=getAgentOrders  params: actor_id */
function getAgentOrders(p) {
  const err = requireFields(p, ['actor_id']);
  if (err) return { success: false, error: err };

  const target = String(p.actor_id).trim();
  const rows = sheetToObjects(getSheet('Orders'));
  const orders = rows
    .filter(function (r) { return String(r.agent_id).trim() === target; })
    .sort(function (a, b) {
      const da = safeDate(a.submitted_at), db = safeDate(b.submitted_at);
      if (da && db) return db - da;
      return 0;
    });

  const completedOrders = orders.filter(function (o) { return String(o.status).trim() === 'Cashback Sent'; });

  const stats = {
    total: orders.length,
    pending: orders.filter(function (o) { return ACTIVE_ORDER_STATUSES.indexOf(String(o.status).trim()) !== -1; }).length,
    completed: completedOrders.length,
    total_cashback: completedOrders.reduce(function (sum, o) { return sum + toNumber(o.cashback_amount); }, 0)
  };

  return { success: true, orders: orders, stats: stats };
}

// ====================================================================================
// 7. SELLER ACTIONS
// ====================================================================================

/** action=sellerLogin  params: seller_id, password */
function sellerLogin(p) {
  const err = requireFields(p, ['seller_id', 'password']);
  if (err) return { success: false, error: err };

  const rows = sheetToObjects(getSheet('Sellers'));
  const target = String(p.seller_id).trim();
  const seller = rows.find(function (r) { return String(r.seller_id).trim() === target; });

  if (!seller) return { success: false, error: 'Invalid seller ID or password.' };
  if (String(seller.status).trim() !== 'Active') {
    return { success: false, error: 'This seller account is disabled. Please contact support.' };
  }
  if (String(seller.password || '').trim() !== hashPassword(p.password)) {
    return { success: false, error: 'Invalid seller ID or password.' };
  }

  return {
    success: true,
    token: makeToken(seller.seller_id, 'seller'),
    actor: stripPassword(seller)
  };
}

/** action=getSellerOrders  params: actor_id, status? */
function getSellerOrders(p) {
  const err = requireFields(p, ['actor_id']);
  if (err) return { success: false, error: err };

  const target = String(p.actor_id).trim();
  const rows = sheetToObjects(getSheet('Orders')).filter(function (r) {
    return String(r.seller_id).trim() === target;
  });

  const stats = {
    total: rows.length,
    pending: rows.filter(function (o) { return String(o.status).trim() === 'Pending'; }).length,
    delivered: rows.filter(function (o) { return String(o.status).trim() === 'Delivered'; }).length,
    cashback_sent: rows.filter(function (o) { return String(o.status).trim() === 'Cashback Sent'; }).length,
    rejected: rows.filter(function (o) { return String(o.status).trim() === 'Rejected'; }).length
  };

  let orders = rows;
  if (p.status && String(p.status).trim()) {
    const wantStatus = String(p.status).trim();
    orders = orders.filter(function (o) { return String(o.status).trim() === wantStatus; });
  }

  orders = orders.slice().sort(function (a, b) {
    const da = safeDate(a.submitted_at), db = safeDate(b.submitted_at);
    if (da && db) return db - da;
    return 0;
  });

  return { success: true, orders: orders, stats: stats };
}

/**
 * action=updateOrderStatus  params: order_id, status?, seller_notes?, cashback_proof_url?,
 *                                    actor_id?, actor_type?
 * Used by sellers (and admin) to move an order through its lifecycle.
 */
function updateOrderStatus(p) {
  const err = requireFields(p, ['order_id']);
  if (err) return { success: false, error: err };

  if (p.status !== undefined && ORDER_STATUSES.indexOf(p.status) === -1) {
    return { success: false, error: 'Invalid status. Must be one of: ' + ORDER_STATUSES.join(', ') };
  }

  const sheet = getSheet('Orders');
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });

  const idCol = headers.indexOf('order_id');
  if (idCol === -1) return { success: false, error: 'Orders sheet is missing the order_id column.' };

  const rowIndex = findRowIndex(sheet, idCol + 1, p.order_id);
  if (rowIndex === -1) return { success: false, error: 'Order not found.' };

  if (p.status !== undefined) setCellByHeader(sheet, rowIndex, 'status', p.status);
  if (p.seller_notes !== undefined) setCellByHeader(sheet, rowIndex, 'seller_notes', p.seller_notes);
  if (p.cashback_proof_url !== undefined) setCellByHeader(sheet, rowIndex, 'cashback_proof_url', p.cashback_proof_url);
  setCellByHeader(sheet, rowIndex, 'updated_at', nowIso());

  logActivity(p.actor_id || 'unknown', p.actor_type || 'seller', 'updateOrderStatus', {
    order_id: p.order_id, status: p.status, seller_notes: p.seller_notes
  });

  const updated = sheetToObjects(sheet).find(function (r) { return String(r.order_id).trim() === String(p.order_id).trim(); });
  return { success: true, order: updated };
}

// ====================================================================================
// 8. ADMIN ACTIONS
// ====================================================================================

/** action=getAdminDashboard */
function getAdminDashboard(p) {
  const products = sheetToObjects(getSheet('Products'));
  const orders = sheetToObjects(getSheet('Orders'));
  const agents = sheetToObjects(getSheet('Agents'));
  const sellers = sheetToObjects(getSheet('Sellers'));

  const activeProducts = products.filter(function (pr) { return String(pr.status).trim() === 'Active'; }).length;

  const tz = Session.getScriptTimeZone();
  const todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  const todayOrders = orders.filter(function (o) {
    const d = safeDate(o.submitted_at);
    return d && Utilities.formatDate(d, tz, 'yyyy-MM-dd') === todayKey;
  }).length;

  const pendingOrders = orders.filter(function (o) {
    return ACTIVE_ORDER_STATUSES.indexOf(String(o.status).trim()) !== -1;
  }).length;

  const cashbackSentOrders = orders.filter(function (o) { return String(o.status).trim() === 'Cashback Sent'; });
  const totalCashbackSent = cashbackSentOrders.reduce(function (sum, o) { return sum + toNumber(o.cashback_amount); }, 0);

  // 7-day order volume, oldest -> newest
  const volume = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayKey = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    const label = Utilities.formatDate(d, tz, 'MMM d');
    const count = orders.filter(function (o) {
      const od = safeDate(o.submitted_at);
      return od && Utilities.formatDate(od, tz, 'yyyy-MM-dd') === dayKey;
    }).length;
    volume.push({ date: label, count: count });
  }

  const recentOrders = orders.slice().sort(function (a, b) {
    const da = safeDate(a.submitted_at), db = safeDate(b.submitted_at);
    if (da && db) return db - da;
    return 0;
  }).slice(0, 10);

  return {
    success: true,
    stats: {
      active_products: activeProducts,
      total_orders: orders.length,
      today_orders: todayOrders,
      pending_orders: pendingOrders,
      cashback_sent_count: cashbackSentOrders.length,
      total_cashback_sent: totalCashbackSent,
      agents_count: agents.length,
      sellers_count: sellers.length
    },
    volume: volume,
    recent_orders: recentOrders
  };
}

/**
 * action=addProduct  params: title, link, cashback_amount, + all optional Product fields
 */
function addProduct(p) {
  const err = requireFields(p, ['title', 'link', 'cashback_amount']);
  if (err) return { success: false, error: err };

  if (isNaN(parseFloat(p.cashback_amount))) {
    return { success: false, error: 'Cashback amount must be a number.' };
  }

  const featuredFlag = (p.featured === true || String(p.featured).trim().toUpperCase() === 'TRUE') ? 'TRUE' : 'FALSE';

  const product = {
    product_id: generateId('PRD-'),
    title: String(p.title).trim(),
    link: String(p.link).trim(),
    cashback_amount: p.cashback_amount,
    image_url: p.image_url || '',
    sold_by: p.sold_by || '',
    policy: p.policy || '',
    category: (p.category && String(p.category).trim()) || 'General',
    description: p.description || '',
    deadline: p.deadline || '',
    tags: p.tags || '',
    featured: featuredFlag,
    stock_status: (p.stock_status && String(p.stock_status).trim()) || 'Available',
    instructions: p.instructions || '',
    badge_text: p.badge_text || '',
    status: 'Active',
    created_at: nowIso(),
    seller_id: p.seller_id || ''
  };

  appendRowByHeaders(getSheet('Products'), product);
  logActivity(p.actor_id || 'admin', p.actor_type || 'admin', 'addProduct', {
    product_id: product.product_id, title: product.title
  });

  return { success: true, product: product };
}

/** action=updateProduct  params: product_id, + any editable Product fields */
function updateProduct(p) {
  const err = requireFields(p, ['product_id']);
  if (err) return { success: false, error: err };

  if (p.cashback_amount !== undefined && isNaN(parseFloat(p.cashback_amount))) {
    return { success: false, error: 'Cashback amount must be a number.' };
  }

  const sheet = getSheet('Products');
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });

  const idCol = headers.indexOf('product_id');
  if (idCol === -1) return { success: false, error: 'Products sheet is missing the product_id column.' };

  const rowIndex = findRowIndex(sheet, idCol + 1, p.product_id);
  if (rowIndex === -1) return { success: false, error: 'Product not found.' };

  const editable = [
    'title', 'link', 'cashback_amount', 'image_url', 'sold_by', 'policy', 'category',
    'description', 'deadline', 'tags', 'featured', 'stock_status', 'instructions',
    'badge_text', 'status', 'seller_id'
  ];

  editable.forEach(function (field) {
    if (p[field] !== undefined) {
      let val = p[field];
      if (field === 'featured') {
        val = (val === true || String(val).trim().toUpperCase() === 'TRUE') ? 'TRUE' : 'FALSE';
      }
      setCellByHeader(sheet, rowIndex, field, val);
    }
  });

  logActivity(p.actor_id || 'admin', p.actor_type || 'admin', 'updateProduct', { product_id: p.product_id });

  const updated = sheetToObjects(sheet).find(function (r) { return String(r.product_id).trim() === String(p.product_id).trim(); });
  return { success: true, product: updated };
}

/** action=deleteProduct  params: product_id  (soft delete -> status = "Deleted") */
function deleteProduct(p) {
  const err = requireFields(p, ['product_id']);
  if (err) return { success: false, error: err };

  const sheet = getSheet('Products');
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });

  const idCol = headers.indexOf('product_id');
  if (idCol === -1) return { success: false, error: 'Products sheet is missing the product_id column.' };

  const rowIndex = findRowIndex(sheet, idCol + 1, p.product_id);
  if (rowIndex === -1) return { success: false, error: 'Product not found.' };

  setCellByHeader(sheet, rowIndex, 'status', 'Deleted');
  logActivity(p.actor_id || 'admin', p.actor_type || 'admin', 'deleteProduct', { product_id: p.product_id });

  return { success: true, message: 'Product deleted.' };
}

/** action=addAgent  params: name, password, whatsapp, email?, commission_rate? */
function addAgent(p) {
  const err = requireFields(p, ['name', 'password', 'whatsapp']);
  if (err) return { success: false, error: err };

  const agent = {
    agent_id: generateId('AGT-'),
    name: String(p.name).trim(),
    password: hashPassword(p.password),
    email: p.email || '',
    whatsapp: String(p.whatsapp).trim(),
    commission_rate: p.commission_rate !== undefined ? p.commission_rate : 0,
    total_orders: 0,
    total_commission: 0,
    status: 'Active',
    created_at: nowIso()
  };

  appendRowByHeaders(getSheet('Agents'), agent);
  logActivity(p.actor_id || 'admin', 'admin', 'addAgent', { agent_id: agent.agent_id, name: agent.name });

  return { success: true, agent: stripPassword(agent) };
}

/** action=updateAgent  params: agent_id, + any editable Agent fields (password optional, re-hashed) */
function updateAgent(p) {
  const err = requireFields(p, ['agent_id']);
  if (err) return { success: false, error: err };

  const sheet = getSheet('Agents');
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });

  const idCol = headers.indexOf('agent_id');
  if (idCol === -1) return { success: false, error: 'Agents sheet is missing the agent_id column.' };

  const rowIndex = findRowIndex(sheet, idCol + 1, p.agent_id);
  if (rowIndex === -1) return { success: false, error: 'Agent not found.' };

  const editable = ['name', 'email', 'whatsapp', 'commission_rate', 'status', 'total_orders', 'total_commission'];
  editable.forEach(function (field) {
    if (p[field] !== undefined) setCellByHeader(sheet, rowIndex, field, p[field]);
  });

  if (p.password !== undefined && String(p.password).trim() !== '') {
    setCellByHeader(sheet, rowIndex, 'password', hashPassword(p.password));
  }

  logActivity(p.actor_id || 'admin', 'admin', 'updateAgent', { agent_id: p.agent_id });

  const updated = sheetToObjects(sheet).find(function (r) { return String(r.agent_id).trim() === String(p.agent_id).trim(); });
  return { success: true, agent: stripPassword(updated) };
}

/** action=addSeller  params: name, password, whatsapp, email?, store_name? — returns generated seller_id */
function addSeller(p) {
  const err = requireFields(p, ['name', 'password', 'whatsapp']);
  if (err) return { success: false, error: err };

  const seller = {
    seller_id: generateId('SEL-'),
    name: String(p.name).trim(),
    password: hashPassword(p.password),
    email: p.email || '',
    whatsapp: String(p.whatsapp).trim(),
    store_name: p.store_name || String(p.name).trim(),
    status: 'Active',
    created_at: nowIso()
  };

  appendRowByHeaders(getSheet('Sellers'), seller);
  logActivity(p.actor_id || 'admin', 'admin', 'addSeller', { seller_id: seller.seller_id, name: seller.name });

  return { success: true, seller: stripPassword(seller), seller_id: seller.seller_id };
}

/** action=getAgents — passwords stripped */
function getAgents(p) {
  const rows = sheetToObjects(getSheet('Agents')).map(stripPassword);
  return { success: true, agents: rows };
}

/** action=getSellers — passwords stripped */
function getSellers(p) {
  const rows = sheetToObjects(getSheet('Sellers')).map(stripPassword);
  return { success: true, sellers: rows };
}

/** action=getAllOrders — all orders, newest first (admin filters/searches client-side) */
function getAllOrders(p) {
  const rows = sheetToObjects(getSheet('Orders')).sort(function (a, b) {
    const da = safeDate(a.submitted_at), db = safeDate(b.submitted_at);
    if (da && db) return db - da;
    return 0;
  });
  return { success: true, orders: rows, total: rows.length };
}

// ====================================================================================
// 9. FILE UPLOADS  (POST text/plain only — see build brief §2.3)
// ====================================================================================

/**
 * action=uploadFile  (POST, text/plain, JSON body)
 * params: filename, base64data, mimetype
 * Saves the decoded file into the configured Drive folder. setSharing() is
 * best-effort — the folder is already shared "Anyone with the link", so a
 * setSharing failure on the file itself must never block the response.
 */
function uploadFile(p) {
  const err = requireFields(p, ['filename', 'base64data', 'mimetype']);
  if (err) return { success: false, error: err };

  try {
    let base64 = String(p.base64data);
    const commaIdx = base64.indexOf(',');
    if (base64.substring(0, 5) === 'data:' && commaIdx !== -1) {
      base64 = base64.substring(commaIdx + 1); // strip "data:image/png;base64," prefix if present
    }

    let decoded;
    try {
      decoded = Utilities.base64Decode(base64);
    } catch (decodeErr) {
      return { success: false, error: 'The uploaded file data is not valid base64.' };
    }

    if (decoded.length > MAX_UPLOAD_BYTES) {
      return { success: false, error: 'File is too large. Maximum size is 5MB.' };
    }
    if (decoded.length === 0) {
      return { success: false, error: 'The uploaded file is empty.' };
    }

    const safeName = String(p.filename).replace(/[\/\\]/g, '_');
    const blob = Utilities.newBlob(decoded, p.mimetype, safeName);

    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const file = folder.createFile(blob);

    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      // Non-fatal: the folder is already shared, files inside inherit access.
    }

    logActivity(p.actor_id || 'unknown', p.actor_type || 'buyer', 'uploadFile', {
      filename: safeName, mimetype: p.mimetype, bytes: decoded.length
    });

    return { success: true, url: 'https://drive.google.com/uc?id=' + file.getId(), file_id: file.getId() };
  } catch (e) {
    return { success: false, error: 'Upload failed: ' + (e && e.message ? e.message : String(e)) };
  }
}
