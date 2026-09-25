<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import {
  createOrder,
  fetchEcommerceCategories,
  fetchEcommerceProducts,
  fetchProductDetail,
  fetchUserAddresses,
  fetchUserOrders,
} from '../api'
import { authStore } from '../store/auth'

const emit = defineEmits(['switch-view', 'ask-cs'])

// 状态管理
const loading = ref(false)
const products = ref([])
const categories = ref([])
const selectedCategoryId = ref(null)
const searchKeyword = ref('')
const onlyHot = ref(false)
const error = ref('')

// 商品详情与购买弹窗
const showDetailModal = ref(false)
const detailLoading = ref(false)
const currentProduct = ref(null)
const selectedSku = ref(null)
const buyQuantity = ref(1)
const paymentMethod = ref('alipay')
const buyerMessage = ref('')

// 收货人信息
const receiverName = ref('')
const receiverPhone = ref('')
const receiverAddress = ref('')
const buying = ref(false)

// 下单成功结果弹窗
const showSuccessModal = ref(false)
const lastOrderResult = ref(null)

// 我的订单抽屉
const showOrdersModal = ref(false)
const ordersLoading = ref(false)
const userOrders = ref([])
const orderStatusFilter = ref(null)

// 过滤后的商品列表
const filteredProducts = computed(() => {
  return products.value.filter((p) => {
    if (selectedCategoryId.value && p.category_id !== selectedCategoryId.value) {
      return false
    }
    if (onlyHot.value && !p.is_hot) {
      return false
    }
    if (searchKeyword.value.trim()) {
      const kw = searchKeyword.value.trim().toLowerCase()
      const titleMatch = p.title.toLowerCase().includes(kw)
      const subMatch = (p.sub_title || '').toLowerCase().includes(kw)
      const brandMatch = (p.brand_name || '').toLowerCase().includes(kw)
      if (!titleMatch && !subMatch && !brandMatch) return false
    }
    return true
  })
})

// 计算单价与总价
const currentUnitPrice = computed(() => {
  if (selectedSku.value) {
    return Number(selectedSku.value.price)
  }
  return currentProduct.value ? Number(currentProduct.value.sale_price) : 0
})

const currentOriginalPrice = computed(() => {
  if (selectedSku.value && selectedSku.value.original_price > 0) {
    return Number(selectedSku.value.original_price)
  }
  return currentProduct.value ? Number(currentProduct.value.original_price) : 0
})

const currentStock = computed(() => {
  if (selectedSku.value) {
    return selectedSku.value.stock
  }
  return currentProduct.value ? currentProduct.value.stock_total : 0
})

const totalAmount = computed(() => {
  return (currentUnitPrice.value * buyQuantity.value).toFixed(2)
})

// 加载商品列表与分类
async function loadProductsData() {
  loading.value = true
  error.value = ''
  try {
    const [cats, prods] = await Promise.all([
      fetchEcommerceCategories(),
      fetchEcommerceProducts(),
    ])
    categories.value = cats || []
    products.value = prods || []
  } catch (err) {
    error.value = err.message || '加载商品数据失败'
  } finally {
    loading.value = false
  }
}

// 打开商品详情与购买弹窗
async function openProductDetail(product) {
  detailLoading.value = true
  showDetailModal.value = true
  buyQuantity.value = 1
  buyerMessage.value = ''
  paymentMethod.value = 'alipay'

  // 预填收件信息（登录用户优先）
  const user = authStore.currentUser.value
  receiverName.value = user?.nickname || user?.username || '陈小明'
  receiverPhone.value = user?.phone || '13912345678'
  receiverAddress.value = '广东省 深圳市 南山区 粤海街道高新南一道科技创新园B座901'

  try {
    const detail = await fetchProductDetail(product.id)
    currentProduct.value = detail
    // 默认选中第一个库存 > 0 的规格
    if (detail.skus && detail.skus.length > 0) {
      selectedSku.value = detail.skus.find((s) => s.stock > 0) || detail.skus[0]
    } else {
      selectedSku.value = null
    }

    // 尝试拉取用户默认地址
    if (user?.id) {
      try {
        const addrs = await fetchUserAddresses(user.id)
        if (addrs && addrs.length > 0) {
          const def = addrs.find((a) => a.is_default) || addrs[0]
          receiverName.value = def.receiver_name
          receiverPhone.value = def.receiver_phone
          receiverAddress.value = `${def.province} ${def.city} ${def.district} ${def.detail_address}`.trim()
        }
      } catch {
        // 忽略地址读取错误
      }
    }
  } catch (err) {
    error.value = '加载商品详情失败: ' + err.message
    showDetailModal.value = false
  } finally {
    detailLoading.value = false
  }
}

// 增减购买数量
function adjustQuantity(delta) {
  const target = buyQuantity.value + delta
  if (target >= 1 && target <= currentStock.value) {
    buyQuantity.value = target
  }
}

// 切换选中的规格
function selectSku(sku) {
  selectedSku.value = sku
  if (buyQuantity.value > sku.stock) {
    buyQuantity.value = Math.max(1, sku.stock)
  }
}

// 执行购买下单
async function handleBuyNow() {
  if (!authStore.isAuthenticated.value) {
    authStore.openLogin()
    return
  }

  if (currentStock.value <= 0) {
    alert('该商品/规格暂无库存')
    return
  }

  if (!receiverName.value.trim() || !receiverPhone.value.trim() || !receiverAddress.value.trim()) {
    alert('请完善收件人、联系手机和详细收货地址')
    return
  }

  buying.value = true
  try {
    const payload = {
      product_id: currentProduct.value.id,
      sku_id: selectedSku.value ? selectedSku.value.id : null,
      quantity: buyQuantity.value,
      receiver_name: receiverName.value.trim(),
      receiver_phone: receiverPhone.value.trim(),
      receiver_address: receiverAddress.value.trim(),
      payment_method: paymentMethod.value,
      buyer_message: buyerMessage.value.trim(),
      pay_now: true,
    }

    const orderRes = await createOrder(payload)
    lastOrderResult.value = orderRes
    showDetailModal.value = false
    showSuccessModal.value = true

    // 重新拉取商品列表刷新销量和库存
    loadProductsData()
  } catch (err) {
    alert('下单失败: ' + (err.message || '未知错误'))
  } finally {
    buying.value = false
  }
}

// 打开“我的订单”弹窗
async function openMyOrders() {
  if (!authStore.isAuthenticated.value) {
    authStore.openLogin()
    return
  }
  showOrdersModal.value = true
  ordersLoading.value = true
  try {
    const uid = authStore.currentUser.value?.id
    userOrders.value = await fetchUserOrders(uid, orderStatusFilter.value)
  } catch (err) {
    alert('拉取订单列表失败: ' + err.message)
  } finally {
    ordersLoading.value = false
  }
}

// 切换订单状态过滤
async function handleOrderStatusChange(status) {
  orderStatusFilter.value = status
  openMyOrders()
}

// 前往智能客服提问验证 Text-to-SQL
function goToCustomerService() {
  showSuccessModal.value = false
  showOrdersModal.value = false
  emit('switch-view', 'cs')
}

onMounted(() => {
  loadProductsData()
})

// 监听登录态刷新订单
watch(
  () => authStore.isAuthenticated.value,
  (isAuth) => {
    if (isAuth && showOrdersModal.value) {
      openMyOrders()
    }
  }
)
</script>

<template>
  <div class="product-mall-view">
    <!-- 商城顶部广告与功能横幅 -->
    <header class="mall-hero">
      <div class="hero-content">
        <div class="hero-badge">🛒 易学商城 · 官方自营旗舰</div>
        <h2 class="hero-title">精品好物展厅 · 正版直达</h2>
        <p class="hero-subtitle">
          全套官方雅思教材 · 0.2s 极速智能翻译笔 · 专业降噪耳机 · 名师专属 1对1 提分冲刺
        </p>
      </div>
      <div class="hero-actions">
        <button class="hero-orders-btn" type="button" @click="openMyOrders">
          📦 我的订单记录
          <span v-if="authStore.isAuthenticated.value" class="btn-user-tag">
            ({{ authStore.currentUser.value?.nickname || authStore.currentUser.value?.username }})
          </span>
        </button>
      </div>
    </header>

    <!-- 筛选与搜索工具条 -->
    <section class="mall-toolbar">
      <div class="category-tabs">
        <button
          class="cat-chip"
          :class="{ active: selectedCategoryId === null }"
          type="button"
          @click="selectedCategoryId = null"
        >
          全部商品 ({{ products.length }})
        </button>
        <button
          v-for="cat in categories"
          :key="cat.id"
          class="cat-chip"
          :class="{ active: selectedCategoryId === cat.id }"
          type="button"
          @click="selectedCategoryId = cat.id"
        >
          {{ cat.name }}
        </button>
      </div>

      <div class="search-filter-wrap">
        <div class="search-input-box">
          <span class="search-icon">🔍</span>
          <input
            v-model="searchKeyword"
            type="text"
            placeholder="搜索商品名称、品牌或卖点..."
            class="mall-search-input"
          />
          <button
            v-if="searchKeyword"
            type="button"
            class="clear-search-btn"
            @click="searchKeyword = ''"
          >
            ✕
          </button>
        </div>

        <label class="hot-checkbox-label">
          <input v-model="onlyHot" type="checkbox" />
          <span>🔥 只看热销推荐</span>
        </label>
      </div>
    </section>

    <!-- 加载中或错误提示 -->
    <div v-if="loading" class="loading-state">
      <div class="spinner-large"></div>
      <p>正在为您同步易学商城最新商品库存…</p>
    </div>

    <div v-else-if="error" class="error-banner">
      {{ error }}
      <button class="retry-btn" type="button" @click="loadProductsData">重试</button>
    </div>

    <!-- 商品列表卡片流 -->
    <section v-else class="product-grid">
      <div
        v-for="item in filteredProducts"
        :key="item.id"
        class="product-card"
        @click="openProductDetail(item)"
      >
        <div class="card-img-wrap">
          <img :src="item.main_image" :alt="item.title" class="product-thumb" loading="lazy" />
          <span v-if="item.is_hot" class="badge-hot">🔥 热销推荐</span>
          <span class="badge-cat">{{ item.category_name }}</span>
        </div>

        <div class="card-body">
          <div class="brand-row">
            <span class="brand-tag">{{ item.brand_name || '易学精选' }}</span>
            <span class="spu-code">{{ item.spu_code }}</span>
          </div>

          <h3 class="product-title" :title="item.title">{{ item.title }}</h3>
          <p class="product-subtitle" :title="item.sub_title">{{ item.sub_title || '品质保证 · 官方顺丰包邮 · 7天退换' }}</p>

          <div class="price-stock-row">
            <div class="price-box">
              <span class="currency">¥</span>
              <span class="sale-price">{{ item.sale_price }}</span>
              <span v-if="item.original_price > item.sale_price" class="orig-price">
                ¥{{ item.original_price }}
              </span>
            </div>
            <div class="sales-tag">已售 {{ item.sales_count }} 件</div>
          </div>

          <div class="card-actions">
            <button class="btn-detail" type="button" @click.stop="openProductDetail(item)">
              查看详情
            </button>
            <button class="btn-buy" type="button" @click.stop="openProductDetail(item)">
              立即购买
            </button>
          </div>
        </div>
      </div>
    </section>

    <div v-if="!loading && filteredProducts.length === 0" class="empty-state">
      <span class="empty-icon">🛍️</span>
      <p>未找到符合条件的商品</p>
      <button class="reset-filter-btn" type="button" @click="selectedCategoryId = null; searchKeyword = ''; onlyHot = false">
        重置筛选条件
      </button>
    </div>

    <!-- 弹窗 1：商品详情与即时购买下单弹窗 -->
    <Teleport to="body">
      <div v-if="showDetailModal" class="modal-backdrop" @click.self="showDetailModal = false">
        <div class="modal-card detail-modal">
          <button class="modal-close-btn" type="button" @click="showDetailModal = false">✕</button>

          <div v-if="detailLoading" class="detail-loading">
            <div class="spinner-large"></div>
            <p>正在加载商品全量规格与详情…</p>
          </div>

          <div v-else-if="currentProduct" class="detail-layout">
            <!-- 左侧：大图与保障 -->
            <div class="detail-media-col">
              <div class="detail-img-box">
                <img
                  :src="selectedSku?.sku_image || currentProduct.main_image"
                  :alt="currentProduct.title"
                  class="detail-main-img"
                />
              </div>
              <div class="trust-badges">
                <div class="trust-item"><span>🛡️ 官方正品保障</span></div>
                <div class="trust-item"><span>🚀 顺丰极速配送</span></div>
                <div class="trust-item"><span>↩️ 7天无理由退换</span></div>
                <div class="trust-item"><span>🧾 支持开具电子发票</span></div>
              </div>
            </div>

            <!-- 右侧：商品选规与购买下单面板 -->
            <div class="detail-info-col">
              <div class="info-header">
                <div class="detail-tags">
                  <span class="badge-cat">{{ currentProduct.category_name }}</span>
                  <span class="brand-tag">{{ currentProduct.brand_name || '易学自营' }}</span>
                </div>
                <h3 class="detail-title">{{ currentProduct.title }}</h3>
                <p class="detail-sub">{{ currentProduct.sub_title }}</p>
              </div>

              <!-- 价格展示 -->
              <div class="detail-price-banner">
                <div class="price-group">
                  <span class="price-label">优惠售价</span>
                  <span class="detail-currency">¥</span>
                  <span class="detail-sale-price">{{ currentUnitPrice.toFixed(2) }}</span>
                  <span v-if="currentOriginalPrice > currentUnitPrice" class="detail-orig-price">
                    ¥{{ currentOriginalPrice.toFixed(2) }}
                  </span>
                </div>
                <div class="stock-badge">
                  <span>库存：{{ currentStock }} 件</span>
                </div>
              </div>

              <!-- 规格 SKU 选择 -->
              <div v-if="currentProduct.skus?.length" class="sku-selector-group">
                <label class="field-label">选择规格 / 版本：</label>
                <div class="sku-options">
                  <button
                    v-for="sku in currentProduct.skus"
                    :key="sku.id"
                    type="button"
                    class="sku-chip"
                    :class="{
                      active: selectedSku?.id === sku.id,
                      disabled: sku.stock <= 0,
                    }"
                    :disabled="sku.stock <= 0"
                    @click="selectSku(sku)"
                  >
                    <span class="sku-text">{{ sku.spec_data }}</span>
                    <span class="sku-price">¥{{ sku.price }}</span>
                  </button>
                </div>
              </div>

              <!-- 购买数量 -->
              <div class="quantity-group">
                <label class="field-label">购买数量：</label>
                <div class="quantity-stepper">
                  <button type="button" class="step-btn" :disabled="buyQuantity <= 1" @click="adjustQuantity(-1)">-</button>
                  <input v-model.number="buyQuantity" type="number" min="1" :max="currentStock" class="step-input" readonly />
                  <button type="button" class="step-btn" :disabled="buyQuantity >= currentStock" @click="adjustQuantity(1)">+</button>
                </div>
                <span class="subtotal-hint">小计：¥{{ totalAmount }}</span>
              </div>

              <!-- 收货人信息表单 (默认带出陈小明地址) -->
              <div class="receiver-form-group">
                <div class="section-title-row">
                  <label class="field-label">📍 收货信息（自动填入默认地址）：</label>
                </div>
                <div class="address-grid">
                  <input
                    v-model="receiverName"
                    type="text"
                    placeholder="收件人姓名 (如: 陈小明)"
                    class="form-input"
                  />
                  <input
                    v-model="receiverPhone"
                    type="text"
                    placeholder="联系电话 (如: 13912345678)"
                    class="form-input"
                  />
                  <input
                    v-model="receiverAddress"
                    type="text"
                    placeholder="详细收货地址 (省/市/区/门牌号)"
                    class="form-input span-2"
                  />
                </div>
              </div>

              <!-- 支付渠道选择 -->
              <div class="payment-method-group">
                <label class="field-label">支付方式：</label>
                <div class="pay-options">
                  <label class="pay-label" :class="{ selected: paymentMethod === 'alipay' }">
                    <input v-model="paymentMethod" type="radio" value="alipay" />
                    <span>🔵 支付宝支付 (推荐)</span>
                  </label>
                  <label class="pay-label" :class="{ selected: paymentMethod === 'wechat' }">
                    <input v-model="paymentMethod" type="radio" value="wechat" />
                    <span>🟢 微信快捷支付</span>
                  </label>
                  <label class="pay-label" :class="{ selected: paymentMethod === 'credit_card' }">
                    <input v-model="paymentMethod" type="radio" value="credit_card" />
                    <span>💳 银联云闪付</span>
                  </label>
                </div>
              </div>

              <!-- 订单备注 -->
              <div class="message-group">
                <input
                  v-model="buyerMessage"
                  type="text"
                  placeholder="买家留言备注（例如：尽量安排顺丰发货，急用谢谢！）"
                  class="form-input message-input"
                />
              </div>

              <!-- 底部操作结算条 -->
              <div class="detail-footer">
                <div class="footer-total">
                  <span class="total-label">实付总额：</span>
                  <span class="footer-currency">¥</span>
                  <span class="footer-amount">{{ totalAmount }}</span>
                </div>
                <button
                  type="button"
                  class="submit-order-btn"
                  :disabled="buying || currentStock <= 0"
                  @click="handleBuyNow"
                >
                  <span v-if="buying" class="spinner-small"></span>
                  {{ buying ? '正在下单扣减库存…' : '立即下单并支付 ➔' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 弹窗 2：下单成功通知与智能客服连通弹窗 -->
    <Teleport to="body">
      <div v-if="showSuccessModal" class="modal-backdrop" @click.self="showSuccessModal = false">
        <div class="modal-card success-modal">
          <div class="success-icon-wrap">🎉</div>
          <h3 class="success-title">支付成功！订单已生成</h3>
          <p class="success-sub">您的购买记录已真实写入商城数据库，可通过智能客服直接查询！</p>

          <div v-if="lastOrderResult" class="order-receipt-card">
            <div class="receipt-row">
              <span class="r-label">订单编号：</span>
              <strong class="r-value highlight">{{ lastOrderResult.order_no }}</strong>
            </div>
            <div class="receipt-row">
              <span class="r-label">购买商品：</span>
              <span class="r-value">{{ lastOrderResult.product_title }}</span>
            </div>
            <div class="receipt-row">
              <span class="r-label">购买规格：</span>
              <span class="r-value">{{ lastOrderResult.spec_data || '标准版' }}</span>
            </div>
            <div class="receipt-row">
              <span class="r-label">成交单价与件数：</span>
              <span class="r-value">¥{{ lastOrderResult.unit_price }} × {{ lastOrderResult.quantity }} 件</span>
            </div>
            <div class="receipt-row">
              <span class="r-label">实付总金额：</span>
              <strong class="r-value price-red">¥{{ lastOrderResult.pay_amount }}</strong>
            </div>
            <div class="receipt-row">
              <span class="r-label">收件人：</span>
              <span class="r-value">{{ lastOrderResult.receiver_name }} ({{ lastOrderResult.receiver_phone }})</span>
            </div>
            <div class="receipt-row">
              <span class="r-label">物流运单：</span>
              <span class="r-value">顺丰速运 · <code>{{ lastOrderResult.tracking_no }}</code></span>
            </div>
          </div>

          <div class="success-actions">
            <button class="btn-ask-cs" type="button" @click="goToCustomerService">
              💬 前往智能客服提问验证此订单 ➔
            </button>
            <button class="btn-continue" type="button" @click="showSuccessModal = false">
              继续逛逛
            </button>
            <button class="btn-view-orders" type="button" @click="showSuccessModal = false; openMyOrders()">
              查看我的订单列表
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 弹窗 3：我的订单列表抽屉 (数据直连数据库真实 orders 表) -->
    <Teleport to="body">
      <div v-if="showOrdersModal" class="modal-backdrop" @click.self="showOrdersModal = false">
        <div class="modal-card orders-modal">
          <header class="orders-head">
            <div>
              <h3 class="orders-title">📦 我的订单列表</h3>
              <p class="orders-sub">
                登录账号：<strong>{{ authStore.currentUser.value?.nickname || authStore.currentUser.value?.username }}</strong>
                · 直查数据库真实订单
              </p>
            </div>
            <button class="modal-close-btn" type="button" @click="showOrdersModal = false">✕</button>
          </header>

          <div class="orders-filter-row">
            <button
              class="filter-chip"
              :class="{ active: orderStatusFilter === null }"
              type="button"
              @click="handleOrderStatusChange(null)"
            >
              全部订单
            </button>
            <button
              class="filter-chip"
              :class="{ active: orderStatusFilter === 1 }"
              type="button"
              @click="handleOrderStatusChange(1)"
            >
              待发货 / 已支付
            </button>
            <button
              class="filter-chip"
              :class="{ active: orderStatusFilter === 2 }"
              type="button"
              @click="handleOrderStatusChange(2)"
            >
              已发货 / 运输中
            </button>
            <button
              class="filter-chip"
              :class="{ active: orderStatusFilter === 3 }"
              type="button"
              @click="handleOrderStatusChange(3)"
            >
              已完成
            </button>
          </div>

          <div class="orders-body">
            <div v-if="ordersLoading" class="loading-state">
              <div class="spinner-small"></div>
              <span>正在拉取我的真实订单…</span>
            </div>

            <div v-else-if="userOrders.length === 0" class="empty-state">
              <span>📭</span>
              <p>暂无符合条件的订单记录</p>
            </div>

            <div v-else class="orders-list">
              <div v-for="order in userOrders" :key="order.id" class="order-card-item">
                <div class="order-header-line">
                  <div class="order-no-wrap">
                    <span class="order-label">订单号：</span>
                    <strong>{{ order.order_no }}</strong>
                    <span class="order-time">{{ order.created_at }}</span>
                  </div>
                  <div class="order-status-badge" :class="'status-' + order.order_status">
                    {{
                      order.order_status === 0
                        ? '待付款'
                        : order.order_status === 1
                        ? '已支付 / 待发货'
                        : order.order_status === 2
                        ? '顺丰配送中'
                        : order.order_status === 3
                        ? '已签收完成'
                        : '已处理'
                    }}
                  </div>
                </div>

                <div class="order-goods-list">
                  <div v-for="item in order.items" :key="item.id" class="order-good-row">
                    <img :src="item.product_image" :alt="item.product_title" class="good-thumb" />
                    <div class="good-info">
                      <div class="good-title">{{ item.product_title }}</div>
                      <div class="good-spec">{{ item.spec_data || '标准配置' }}</div>
                    </div>
                    <div class="good-price-qty">
                      <div class="good-price">¥{{ item.unit_price }}</div>
                      <div class="good-qty">× {{ item.quantity }}</div>
                    </div>
                  </div>
                </div>

                <div class="order-footer-line">
                  <div class="order-receiver-brief">
                    <span>收件人：{{ order.receiver_name }}（{{ order.receiver_phone }}）</span>
                    <span v-if="order.logistics">· 顺丰单号: {{ order.logistics.tracking_no }}</span>
                  </div>
                  <div class="order-pay-total">
                    <span>实付款：</span>
                    <span class="total-price-text">¥{{ order.pay_amount }}</span>
                    <button class="ask-cs-link" type="button" @click="goToCustomerService">
                      去客服查此单 →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.product-mall-view {
  display: flex;
  flex-direction: column;
  gap: 20px;
  animation: fadeIn 0.25s ease-out;
}

/* 顶部 Banner */
.mall-hero {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #3b82f6 100%);
  color: #fff;
  border-radius: 16px;
  padding: 28px 32px;
  box-shadow: 0 10px 25px -5px rgba(37, 99, 235, 0.25);
  flex-wrap: wrap;
  gap: 16px;
}

.hero-badge {
  display: inline-block;
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(4px);
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.hero-title {
  font-size: 26px;
  font-weight: 800;
  margin: 0 0 6px 0;
  letter-spacing: -0.5px;
}

.hero-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  margin: 0;
  line-height: 1.5;
}

.hero-orders-btn {
  background: #ffffff;
  color: #1e40af;
  border: none;
  font-size: 14px;
  font-weight: 700;
  padding: 10px 20px;
  border-radius: 10px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.hero-orders-btn:hover {
  background: #f8fafc;
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.16);
}

.btn-user-tag {
  font-size: 12px;
  color: #64748b;
  font-weight: normal;
}

/* 工具栏与分类 */
.mall-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  background: var(--card-bg, #ffffff);
  padding: 16px 20px;
  border-radius: 14px;
  border: 1px solid var(--border-color, #e2e8f0);
}

.category-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.cat-chip {
  background: #f1f5f9;
  color: #475569;
  border: 1px solid transparent;
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.cat-chip:hover {
  background: #e2e8f0;
  color: #1e293b;
}

.cat-chip.active {
  background: #2563eb;
  color: #ffffff;
  border-color: #2563eb;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
}

.search-filter-wrap {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.search-input-box {
  display: flex;
  align-items: center;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 6px 12px;
  width: 240px;
}

.search-icon {
  margin-right: 6px;
  font-size: 13px;
}

.mall-search-input {
  border: none;
  background: transparent;
  outline: none;
  font-size: 13px;
  width: 100%;
}

.clear-search-btn {
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
}

.hot-checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #334155;
  cursor: pointer;
  font-weight: 500;
}

/* 商品网格流 */
.product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 22px;
}

.product-card {
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.product-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px -6px rgba(0, 0, 0, 0.1);
  border-color: #93c5fd;
}

.card-img-wrap {
  position: relative;
  width: 100%;
  height: 200px;
  background: #f1f5f9;
  overflow: hidden;
}

.product-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s ease;
}

.product-card:hover .product-thumb {
  transform: scale(1.05);
}

.badge-hot {
  position: absolute;
  top: 10px;
  left: 10px;
  background: linear-gradient(135deg, #ef4444, #f97316);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(239, 68, 68, 0.3);
}

.badge-cat {
  position: absolute;
  top: 10px;
  right: 10px;
  background: rgba(15, 23, 42, 0.75);
  color: #fff;
  font-size: 11px;
  font-weight: 500;
  padding: 3px 8px;
  border-radius: 4px;
  backdrop-filter: blur(4px);
}

.card-body {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.brand-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.brand-tag {
  background: #eff6ff;
  color: #2563eb;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
}

.spu-code {
  font-size: 11px;
  color: #94a3b8;
  font-family: monospace;
}

.product-title {
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 6px 0;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  height: 44px;
}

.product-subtitle {
  font-size: 12px;
  color: #64748b;
  margin: 0 0 14px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.price-stock-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 16px;
  margin-top: auto;
}

.price-box {
  display: flex;
  align-items: baseline;
}

.currency {
  font-size: 14px;
  font-weight: 700;
  color: #ef4444;
  margin-right: 2px;
}

.sale-price {
  font-size: 22px;
  font-weight: 800;
  color: #ef4444;
}

.orig-price {
  font-size: 12px;
  color: #94a3b8;
  text-decoration: line-through;
  margin-left: 6px;
}

.sales-tag {
  font-size: 11px;
  color: #64748b;
}

.card-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.btn-detail {
  background: #f8fafc;
  color: #334155;
  border: 1px solid #cbd5e1;
  padding: 8px 0;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-detail:hover {
  background: #e2e8f0;
  border-color: #94a3b8;
}

.btn-buy {
  background: #2563eb;
  color: #ffffff;
  border: none;
  padding: 8px 0;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-buy:hover {
  background: #1d4ed8;
  box-shadow: 0 4px 10px rgba(37, 99, 235, 0.3);
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #64748b;
}

.empty-icon {
  font-size: 48px;
  display: block;
  margin-bottom: 12px;
}

.reset-filter-btn {
  background: #2563eb;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  margin-top: 12px;
}

/* 模态框通用 */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(5px);
  z-index: 1000;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
  animation: fadeIn 0.2s ease-out;
}

.modal-card {
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.25);
  max-width: 900px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  position: relative;
  animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.modal-close-btn {
  position: absolute;
  top: 16px;
  right: 18px;
  background: #f1f5f9;
  border: none;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  font-size: 14px;
  color: #475569;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  transition: all 0.15s ease;
}

.modal-close-btn:hover {
  background: #e2e8f0;
  color: #0f172a;
}

/* 详情弹窗两栏布局 */
.detail-modal {
  padding: 24px;
}

.detail-layout {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 28px;
}

@media (max-width: 768px) {
  .detail-layout {
    grid-template-columns: 1fr;
  }
}

.detail-media-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-img-box {
  width: 100%;
  height: 320px;
  border-radius: 12px;
  overflow: hidden;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}

.detail-main-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.trust-badges {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  background: #f8fafc;
  padding: 12px;
  border-radius: 10px;
  font-size: 12px;
  color: #475569;
  font-weight: 500;
}

.detail-info-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-tags {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.detail-title {
  font-size: 20px;
  font-weight: 800;
  color: #0f172a;
  margin: 0 0 6px 0;
  line-height: 1.4;
}

.detail-sub {
  font-size: 13px;
  color: #64748b;
  margin: 0;
  line-height: 1.5;
}

.detail-price-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fff1f2;
  border: 1px solid #ffe4e6;
  border-radius: 10px;
  padding: 12px 16px;
}

.price-group {
  display: flex;
  align-items: baseline;
}

.price-label {
  font-size: 12px;
  color: #e11d48;
  font-weight: 600;
  margin-right: 6px;
}

.detail-currency {
  font-size: 16px;
  font-weight: 700;
  color: #e11d48;
}

.detail-sale-price {
  font-size: 26px;
  font-weight: 800;
  color: #e11d48;
}

.detail-orig-price {
  font-size: 13px;
  color: #94a3b8;
  text-decoration: line-through;
  margin-left: 8px;
}

.stock-badge {
  font-size: 12px;
  color: #059669;
  background: #ecfdf5;
  padding: 4px 8px;
  border-radius: 4px;
  font-weight: 600;
}

/* 规格选择 */
.field-label {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: #334155;
  margin-bottom: 8px;
}

.sku-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sku-chip {
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  gap: 8px;
  align-items: center;
  transition: all 0.15s ease;
}

.sku-chip:hover:not(:disabled) {
  border-color: #2563eb;
  background: #eff6ff;
}

.sku-chip.active {
  background: #eff6ff;
  border-color: #2563eb;
  box-shadow: 0 0 0 1px #2563eb;
}

.sku-chip.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  text-decoration: line-through;
}

.sku-text {
  font-size: 13px;
  color: #1e293b;
  font-weight: 500;
}

.sku-price {
  font-size: 12px;
  color: #2563eb;
  font-weight: 700;
}

/* 数量步进器 */
.quantity-group {
  display: flex;
  align-items: center;
  gap: 16px;
}

.quantity-stepper {
  display: flex;
  align-items: center;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  overflow: hidden;
  background: #ffffff;
}

.step-btn {
  background: #f1f5f9;
  border: none;
  width: 32px;
  height: 32px;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  color: #334155;
}

.step-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.step-input {
  width: 44px;
  text-align: center;
  border: none;
  font-weight: 700;
  outline: none;
}

.subtotal-hint {
  font-size: 14px;
  font-weight: 700;
  color: #ef4444;
}

/* 收件信息 */
.receiver-form-group {
  background: #f8fafc;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
}

.address-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.form-input {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s ease;
}

.form-input:focus {
  border-color: #2563eb;
}

.span-2 {
  grid-column: span 2;
}

.pay-options {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.pay-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
}

.pay-label.selected {
  border-color: #2563eb;
  background: #eff6ff;
  color: #1e40af;
  font-weight: 600;
}

.message-input {
  width: 100%;
}

/* 结算条 */
.detail-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid #e2e8f0;
  padding-top: 16px;
  margin-top: 8px;
}

.total-label {
  font-size: 14px;
  color: #475569;
}

.footer-currency {
  font-size: 16px;
  font-weight: 700;
  color: #ef4444;
}

.footer-amount {
  font-size: 26px;
  font-weight: 900;
  color: #ef4444;
}

.submit-order-btn {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: #ffffff;
  border: none;
  font-size: 15px;
  font-weight: 800;
  padding: 12px 28px;
  border-radius: 10px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(239, 68, 68, 0.35);
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 8px;
}

.submit-order-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #dc2626, #b91c1c);
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(239, 68, 68, 0.4);
}

.submit-order-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 成功弹窗 */
.success-modal {
  max-width: 540px;
  padding: 32px 28px;
  text-align: center;
}

.success-icon-wrap {
  font-size: 54px;
  margin-bottom: 12px;
}

.success-title {
  font-size: 22px;
  font-weight: 800;
  color: #0f172a;
  margin: 0 0 6px 0;
}

.success-sub {
  font-size: 13px;
  color: #64748b;
  margin: 0 0 20px 0;
}

.order-receipt-card {
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 12px;
  padding: 16px 20px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
  margin-bottom: 24px;
}

.receipt-row {
  display: flex;
  justify-content: space-between;
}

.r-label {
  color: #64748b;
}

.r-value {
  color: #1e293b;
  font-weight: 500;
}

.r-value.highlight {
  color: #2563eb;
  font-family: monospace;
}

.r-value.price-red {
  color: #ef4444;
  font-size: 15px;
  font-weight: 800;
}

.success-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.btn-ask-cs {
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: #fff;
  border: none;
  font-size: 14px;
  font-weight: 700;
  padding: 12px 0;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
}

.btn-ask-cs:hover {
  background: #1e40af;
}

.btn-continue,
.btn-view-orders {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  color: #334155;
  font-size: 13px;
  font-weight: 600;
  padding: 9px 0;
  border-radius: 8px;
  cursor: pointer;
}

.btn-continue:hover,
.btn-view-orders:hover {
  background: #e2e8f0;
}

/* 订单抽屉弹窗 */
.orders-modal {
  max-width: 760px;
  padding: 24px;
}

.orders-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

.orders-title {
  font-size: 20px;
  font-weight: 800;
  color: #0f172a;
  margin: 0 0 4px 0;
}

.orders-sub {
  font-size: 13px;
  color: #64748b;
  margin: 0;
}

.orders-filter-row {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 12px;
}

.filter-chip {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  color: #64748b;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.filter-chip.active {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}

.orders-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 520px;
  overflow-y: auto;
}

.order-card-item {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px;
  background: #ffffff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
}

.order-header-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  border-bottom: 1px solid #f1f5f9;
  padding-bottom: 10px;
  margin-bottom: 12px;
}

.order-time {
  color: #94a3b8;
  font-size: 12px;
  margin-left: 8px;
}

.order-status-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 4px;
}

.status-1 {
  background: #eff6ff;
  color: #2563eb;
}

.status-2 {
  background: #fef3c7;
  color: #d97706;
}

.status-3 {
  background: #ecfdf5;
  color: #059669;
}

.order-goods-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.order-good-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.good-thumb {
  width: 50px;
  height: 50px;
  border-radius: 6px;
  object-fit: cover;
  background: #f1f5f9;
}

.good-info {
  flex: 1;
}

.good-title {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
}

.good-spec {
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
}

.good-price-qty {
  text-align: right;
}

.good-price {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
}

.good-qty {
  font-size: 12px;
  color: #94a3b8;
}

.order-footer-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid #f1f5f9;
  padding-top: 10px;
  font-size: 12px;
  color: #64748b;
}

.order-pay-total {
  display: flex;
  align-items: center;
  gap: 8px;
}

.total-price-text {
  font-size: 16px;
  font-weight: 800;
  color: #ef4444;
}

.ask-cs-link {
  background: #eff6ff;
  color: #2563eb;
  border: 1px solid #bfdbfe;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.ask-cs-link:hover {
  background: #2563eb;
  color: #fff;
}

/* 动效 */
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes slideUp {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.spinner-small {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  display: inline-block;
}

.spinner-large {
  width: 36px;
  height: 36px;
  border: 3px solid #e2e8f0;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  margin: 0 auto 12px auto;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
