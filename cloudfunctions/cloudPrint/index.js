const cloud = require('wx-server-sdk');
const feie = require('./feieyun');
const { buildReceiptText } = require('./receipt');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COL_SHOP_CONFIG = 'shop_config';

function safeStr(v) { return String(v == null ? '' : v).trim(); }
function textToFeieContent(text) { return String(text || '').replace(/<BR>/g, '\n'); }

async function getShopConfig() {
  const docId = 'main';
  const got = await db.collection(COL_SHOP_CONFIG).doc(docId).get().catch(() => null);
  return (got && got.data) ? got.data : {};
}

exports.main = async (event) => {
  const action = safeStr(event && event.action);

  try {
    const cfg = await getShopConfig();
    const storeName = safeStr(cfg.storeName || '');

    const feieConfig = {
      user: cfg.cloudPrinterUser,
      ukey: cfg.cloudPrinterKey
    };

    if (!feieConfig.user || !feieConfig.ukey) {
      if (action !== 'status') {
          return { ok: false, message: '未配置打印机USER/UKEY' };
      }
    }

    const sn = safeStr(cfg.cloudPrinterSn);
    const times = Math.max(1, Number(cfg.cloudPrinterTimes) || 1);

    if (action === 'autoPrintPaidOrder') {
      if (!sn) return { ok: false, message: '未配置打印机SN' };
      
      const orderId = safeStr(event.orderId || event.id);
      if (!orderId) return { ok: false, message: '缺少订单ID' };

      const got = await db.collection('orders').doc(orderId).get().catch(() => null);
      const order = got && got.data ? { ...got.data, _id: orderId } : null;
      if (!order) return { ok: false, message: '订单不存在' };

      const text = buildReceiptText(order, storeName);
      
      const out = await feie.printMsg({ sn, content: textToFeieContent(text), times }, feieConfig);
      return { ok: true, data: out };
    }
    
    if (action === 'test') {
      if (!sn) return { ok: false, message: '未配置打印机SN' };
      
      const text = `云打印测试单\n时间：${new Date().toLocaleString()}\n${storeName}，云打印已配置成功\n\n`;
      const out = await feie.printMsg({ sn, content: textToFeieContent(text), times }, feieConfig);
      return { ok: true, data: out };
    }
    
    if (action === 'status') {
      if (!sn) return { ok: true, statusText: '未配置SN' };
      const out = await feie.queryPrinterStatus({ sn }, feieConfig);
      const statusText = out?.data || '查询失败';
      return { ok: true, statusText };
    }

    if (action === 'printOrder') {
      if (!sn) return { ok: false, message: '未配置打印机SN' };
      
      const orderId = safeStr(event.orderId || event.id);
      const got = await db.collection('orders').doc(orderId).get().catch(() => null);
      const order = got && got.data ? { ...got.data, _id: orderId } : null;
      if (!order) return { ok: false, message: '订单不存在' };
      
      const text = buildReceiptText(order, storeName);
      const out = await feie.printMsg({ sn, content: textToFeieContent(text), times }, feieConfig);
      return { ok: true, data: out };
    }

    return { ok: false, message: 'unknown_action' };
  } catch (e) {
    console.error('[cloudPrint] error', e);
    return { ok: false, message: e?.message || 'server_error', code: e?.code };
  }
};
