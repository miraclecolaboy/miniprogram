// cloudfunctions/cloudPrint/index.js
const cloud = require('wx-server-sdk');
const feie = require('./feieyun');
const { buildReceiptText } = require('./receipt');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COL_SHOP_CONFIG = 'shop_config';

// 提取辅助函数，避免重复代码
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
    const enabled = !!cfg.cloudPrintOn; // 假设有一个总开关
    const storeName = safeStr(cfg.storeName || '');

    // [核心改造] 从数据库配置组装飞鹅云凭据
    const feieConfig = {
      user: cfg.cloudPrinterUser,
      ukey: cfg.cloudPrinterKey
    };

    // 检查凭据是否存在
    if (!feieConfig.user || !feieConfig.ukey) {
      // 仅在需要打印的 action 中报错，status 查询可以放行
      if (action !== 'status') {
          return { ok: false, message: '未配置打印机USER/UKEY' };
      }
    }

    const sn = safeStr(cfg.cloudPrinterSn);
    const times = Math.max(1, Number(cfg.cloudPrinterTimes) || 1);

    // ===== 自动打印（由支付回调等触发）=====
    if (action === 'autoPrintPaidOrder') {
      if (!sn) return { ok: false, message: '未配置打印机SN' };
      
      const orderId = safeStr(event.orderId || event.id);
      // ... (省略了 isInternalCall, lockAndGetPaidOrder 等，假设它们存在)
      
      // 假设已获取到 order 对象
      const order = { /* ... 您的订单数据 ... */ };
      const text = buildReceiptText(order, storeName);
      
      const out = await feie.printMsg({ sn, content: textToFeieContent(text), times }, feieConfig);
      // ... markPrintOk(orderId, out);
      return { ok: true, data: out };
    }
    
    // ===== 测试打印 =====
    if (action === 'test') {
      if (!sn) return { ok: false, message: '未配置打印机SN' };
      
      const text = `云打印测试单\n时间：${new Date().toLocaleString()}\n${storeName}，云打印已配置成功\n\n`;
      const out = await feie.printMsg({ sn, content: textToFeieContent(text), times }, feieConfig);
      return { ok: true, data: out };
    }
    
    // ===== 查询状态 =====
    if (action === 'status') {
      if (!sn) return { ok: true, statusText: '未配置SN' }; // 状态查询不应报错
      const out = await feie.queryPrinterStatus({ sn }, feieConfig);
      const statusText = out?.data || '查询失败';
      return { ok: true, statusText };
    }

    // ===== 手动打印 =====
    if (action === 'printOrder') {
      // ... (省略了 token 验证等)
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
