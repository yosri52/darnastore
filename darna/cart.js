/**
 * DARNA Mehres Store — Global Panier (Shopping Cart) Engine
 * Multi-product & Multi-size COD Checkout System
 */

(function() {
  'use strict';

  var CART_KEY = 'darna_cart';
  var ORDERS_KEY = 'darna_orders';
  var TUNISIAN_CITIES = [
    "تونس", "أريانة", "بن عروس", "منوبة", "نابل", "زغوان",
    "بنزرت", "باجة", "جندوبة", "الكاف", "سليانة", "سوسة",
    "المنستير", "المهدية", "صفاقس", "القيروان", "القصرين",
    "سيدي بوزيد", "قابس", "مدنين", "تطاوين", "قفصة", "توزر", "قبلي"
  ];

  window.DarnaCart = {
    TUNISIAN_CITIES: TUNISIAN_CITIES,

    getItems: function() {
      try {
        return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      } catch (e) {
        return [];
      }
    },

    saveItems: function(items) {
      try {
        localStorage.setItem(CART_KEY, JSON.stringify(items));
      } catch (e) {}
      this.updateBadges();
      this.render();
      window.dispatchEvent(new CustomEvent('darna_cart_changed', { detail: { items: items } }));
    },

    getTotalCount: function() {
      var items = this.getItems();
      return items.reduce(function(acc, item) { return acc + (parseInt(item.quantity, 10) || 1); }, 0);
    },

    getSubtotal: function() {
      var items = this.getItems();
      return items.reduce(function(acc, item) {
        var price = parseFloat(item.unit_price) || 0;
        var qty = parseInt(item.quantity, 10) || 1;
        return acc + (price * qty);
      }, 0);
    },

    getDeliveryFee: function() {
      var count = this.getTotalCount();
      if (count === 0) return 0;
      return count >= 2 ? 0.00 : 7.00;
    },

    getTotal: function() {
      return this.getSubtotal() + this.getDeliveryFee();
    },

    generateKey: function(productId, size, color) {
      return (productId || 'prod') + '__' + (size || 'std') + '__' + (color || 'def');
    },

    addItem: function(product, options) {
      options = options || {};
      var items = this.getItems();
      var size = options.size || (typeof product.size === 'string' ? product.size : 'M');
      var color = options.color || (typeof product.color === 'string' ? product.color : 'أصيل');
      var key = this.generateKey(product.id, size, color);
      var qty = parseInt(options.quantity || product.quantity, 10) || 1;
      var price = parseFloat(options.price !== undefined ? options.price : (product.price_tnd !== undefined ? product.price_tnd : product.price)) || 64;
      var img = options.image || product.image_url || product.image || (product.gallery && product.gallery[0]) || 'mehres_classic.jpg';
      if (typeof img === 'string' && img.startsWith('../')) img = img.replace(/^\.\.\//, '');

      var found = items.find(function(it) { return it.key === key; });
      if (found) {
        found.quantity = Math.min(20, (found.quantity || 1) + qty);
      } else {
        items.push({
          key: key,
          id: product.id || 'prod-' + Date.now(),
          name: product.name || 'منتج من دارنا',
          slug: product.slug || 'mehres',
          image: img,
          size: size,
          color: color,
          unit_price: price,
          cost_price: parseFloat(product.cost_price_tnd || product.cost_price) || 0,
          quantity: qty
        });
      }

      this.saveItems(items);
      this.showToast('تمت إضافة ' + (product.name || 'المنتج') + ' (مقاس ' + size + ') إلى السلة');
      this.open();
    },

    updateQty: function(key, delta) {
      var items = this.getItems();
      var idx = items.findIndex(function(it) { return it.key === key; });
      if (idx === -1) return;

      var next = (items[idx].quantity || 1) + delta;
      if (next <= 0) {
        items.splice(idx, 1);
      } else {
        items[idx].quantity = Math.min(20, next);
      }
      this.saveItems(items);
    },

    removeItem: function(key) {
      var items = this.getItems().filter(function(it) { return it.key !== key; });
      this.saveItems(items);
    },

    clear: function() {
      this.saveItems([]);
    },

    updateBadges: function() {
      var count = this.getTotalCount();
      var badges = document.querySelectorAll('.cart-count-badge');
      badges.forEach(function(el) {
        el.textContent = count;
        el.style.display = count > 0 ? 'inline-flex' : 'none';
      });
    },

    open: function() {
      var drawer = document.getElementById('darnaCartDrawer');
      var overlay = document.getElementById('darnaCartOverlay');
      if (drawer && overlay) {
        this.render();
        drawer.classList.add('open');
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
      }
    },
    openCart: function() {
      this.open();
    },

    close: function() {
      var drawer = document.getElementById('darnaCartDrawer');
      var overlay = document.getElementById('darnaCartOverlay');
      if (drawer && overlay) {
        drawer.classList.remove('open');
        overlay.classList.remove('open');
        document.body.style.overflow = '';
      }
    },
    closeCart: function() {
      this.close();
    },

    toggle: function() {
      var drawer = document.getElementById('darnaCartDrawer');
      if (drawer && drawer.classList.contains('open')) this.close();
      else this.open();
    },

    showToast: function(msg) {
      var toast = document.getElementById('darnaCartToast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'darnaCartToast';
        toast.className = 'darna-cart-toast';
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.classList.add('show');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(function() {
        toast.classList.remove('show');
      }, 3000);
    },

    render: function() {
      var listEl = document.getElementById('darnaCartItemsList');
      var summaryEl = document.getElementById('darnaCartSummary');
      var emptyEl = document.getElementById('darnaCartEmpty');
      var freeShipBanner = document.getElementById('darnaCartShippingBanner');
      var countHeaderEl = document.getElementById('darnaCartHeaderCount');

      if (!listEl) return;

      var items = this.getItems();
      var count = this.getTotalCount();
      var subtotal = this.getSubtotal();
      var delivery = this.getDeliveryFee();
      var total = this.getTotal();

      if (countHeaderEl) countHeaderEl.textContent = '(' + count + ')';

      // Shipping progress bar
      if (freeShipBanner) {
        if (count === 0) {
          freeShipBanner.style.display = 'none';
        } else if (count >= 2) {
          freeShipBanner.style.display = 'block';
          freeShipBanner.innerHTML =
            '<div class="darna-ship-bar-wrap success">' +
              '<div class="darna-ship-bar-text">' +
                '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-left:4px"><polyline points="20 6 9 17 4 12"/></svg>' +
                '<b>مبروك!</b> حصلت على <b>توصيل مجاني</b> لباب دارك (لكامل تونس)' +
              '</div>' +
              '<div class="darna-ship-bar-track"><div class="darna-ship-bar-fill" style="width:100%"></div></div>' +
            '</div>';
        } else {
          freeShipBanner.style.display = 'block';
          freeShipBanner.innerHTML =
            '<div class="darna-ship-bar-wrap">' +
              '<div class="darna-ship-bar-text">' +
                '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-left:4px"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>' +
                'أضف <b>قطعة أخرى</b> للحصول على <b>توصيل مجاني</b>!' +
              '</div>' +
              '<div class="darna-ship-bar-track"><div class="darna-ship-bar-fill" style="width:50%"></div></div>' +
            '</div>';
        }
      }

      if (items.length === 0) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'flex';
        if (summaryEl) summaryEl.style.display = 'none';
        return;
      }

      if (emptyEl) emptyEl.style.display = 'none';
      if (summaryEl) summaryEl.style.display = 'block';

      listEl.innerHTML = items.map(function(item) {
        var cleanImg = (item.image || 'mehres_classic.jpg').replace(/^\.\.\//, '');
        return (
          '<div class="darna-cart-item" data-key="' + item.key + '">' +
            '<div class="darna-cart-item-img">' +
              '<img src="' + cleanImg + '" alt="' + item.name + '" onerror="this.onerror=null;this.src=\'logo.jpg\';" />' +
            '</div>' +
            '<div class="darna-cart-item-info">' +
              '<div class="darna-cart-item-title">' + item.name + '</div>' +
              '<div class="darna-cart-item-variants">' +
                (item.size ? '<span class="darna-pill-variant">المقاس: <b>' + item.size + '</b></span>' : '') +
                (item.color ? '<span class="darna-pill-variant">اللون: ' + item.color + '</span>' : '') +
              '</div>' +
              '<div class="darna-cart-item-price-row">' +
                '<div class="darna-cart-item-price">' + (item.unit_price * item.quantity).toFixed(2) + ' DT</div>' +
                '<div class="darna-cart-qty-stepper">' +
                  '<button type="button" class="darna-cart-qty-btn" onclick="DarnaCart.updateQty(\'' + item.key + '\', -1)">−</button>' +
                  '<span class="darna-cart-qty-val">' + item.quantity + '</span>' +
                  '<button type="button" class="darna-cart-qty-btn" onclick="DarnaCart.updateQty(\'' + item.key + '\', 1)">+</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<button type="button" class="darna-cart-item-remove" onclick="DarnaCart.removeItem(\'' + item.key + '\')" title="حذف">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
            '</button>' +
          '</div>'
        );
      }).join('');

      var subtotalValEl = document.getElementById('darnaCartSubtotalVal');
      var deliveryValEl = document.getElementById('darnaCartDeliveryVal');
      var totalValEl = document.getElementById('darnaCartTotalVal');

      if (subtotalValEl) subtotalValEl.textContent = subtotal.toFixed(2) + ' DT';
      if (deliveryValEl) deliveryValEl.textContent = delivery === 0 ? 'مجاني 🎁' : delivery.toFixed(2) + ' DT';
      if (totalValEl) totalValEl.textContent = total.toFixed(2) + ' DT';
    },

    submitCartOrder: function(e) {
      if (e && e.preventDefault) e.preventDefault();

      var items = this.getItems();
      if (!items.length) {
        alert('سلة المشتريات فارغة');
        return false;
      }

      var name = (document.getElementById('cartCustName').value || '').trim();
      var phone = (document.getElementById('cartCustPhone').value || '').trim().replace(/\D/g, '');
      var city = document.getElementById('cartCustCity').value;
      var addr = (document.getElementById('cartCustAddress').value || '').trim();

      if (!name || name.length < 2) { alert('يرجى كتابة الاسم واللقب بالكامل'); return false; }
      if (!phone || phone.length < 8) { alert('يرجى كتابة رقم هاتف تونسي صحيح'); return false; }
      if (!city) { alert('يرجى اختيار الولاية'); return false; }

      var subtotal = this.getSubtotal();
      var delivery = this.getDeliveryFee();
      var total = this.getTotal();

      var localOrders = [];
      try { localOrders = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]'); } catch (err) {}

      var orderNum = 'DARNA-' + new Date().getFullYear() + '-' + String(localOrders.length + 1).padStart(3, '0');

      var itemsListSummary = items.map(function(it) {
        return it.name + ' (' + (it.size ? 'مقاس ' + it.size : '') + (it.color ? ' - ' + it.color : '') + ') × ' + it.quantity;
      }).join(' + ');

      var newOrder = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        order_number: orderNum,
        customer_name: name,
        customer_phone: phone,
        city: city,
        delivery_address: (addr ? addr + '، ' : '') + city,
        order_status: 'pending',
        payment_status: 'pending',
        delivery_fee_tnd: delivery,
        subtotal_tnd: subtotal,
        total_tnd: total,
        customer_notes: 'طلب السلة المجمعة: ' + itemsListSummary,
        internal_notes: 'طلب متعدد من سلة التسوق',
        order_items: items.map(function(it) {
          return {
            product_id: it.id,
            product_name_snapshot: it.name,
            size: it.size,
            color: it.color,
            quantity: it.quantity,
            unit_price_tnd: it.unit_price,
            cost_price_tnd: it.cost_price || 0,
            line_total_tnd: it.unit_price * it.quantity
          };
        }),
        created_at: new Date().toISOString()
      };

      localOrders.unshift(newOrder);
      localStorage.setItem(ORDERS_KEY, JSON.stringify(localOrders));
      window.dispatchEvent(new Event('storage'));

      // Background cloud sync if online
      try {
        fetch('/api/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            phone: phone,
            city: city,
            delivery_address: addr,
            product: itemsListSummary,
            qty: this.getTotalCount(),
            size: items.map(function(it){ return it.size; }).filter(Boolean).join(', '),
            color: items.map(function(it){ return it.color; }).filter(Boolean).join(', ')
          })
        }).catch(function(){});
      } catch(err){}

      // Clear cart
      this.clear();
      this.close();

      // Show success modal
      this.showSuccessModal(newOrder);

      // Exciting AI Voice Confirmation Call (Maryem)
      if (window.DarnaAICall && window.DarnaAICallConfig && window.DarnaAICallConfig.get().enabled) {
        setTimeout(function() {
          window.DarnaAICall.startCallForOrder(newOrder);
        }, 600);
      }
      return false;
    },

    orderViaWhatsApp: function() {
      var items = this.getItems();
      if (!items.length) {
        alert('سلة المشتريات فارغة');
        return;
      }
      var text = 'سلام عليكم دارنا، أريد تأكيد طلب المنتجات من سلة التسوق:\n\n';
      items.forEach(function(it, i) {
        text += (i + 1) + '. ' + it.name + '\n' +
                '   • المقاس: ' + it.size + '\n' +
                '   • النموذج/اللون: ' + it.color + '\n' +
                '   • الكمية: ' + it.quantity + ' قطعة\n' +
                '   • السعر: ' + (it.unit_price * it.quantity) + ' DT\n\n';
      });
      text += 'المجموع الإجمالي: ' + this.getTotal().toFixed(2) + ' DT\n' +
              (this.getDeliveryFee() === 0 ? 'التوصيل: مجاني لكامل تراب الجمهورية\n' : 'التوصيل: 7.00 DT\n') +
              'الرجاء تأكيد الطلب وتحديد موعد التسليم.';

      var waUrl = 'https://wa.me/21627900771?text=' + encodeURIComponent(text);
      window.open(waUrl, '_blank');
    },

    showSuccessModal: function(o) {
      var modal = document.getElementById('darnaCartSuccessModal');
      if (!modal) return;
      var box = document.getElementById('darnaCartSuccessSummary');
      if (box) {
        var itemsHtml = o.order_items.map(function(it) {
          return '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>' + it.product_name_snapshot + ' (مقاس ' + it.size + ') × ' + it.quantity + '</span><b>' + it.line_total_tnd + ' DT</b></div>';
        }).join('');

        box.innerHTML =
          '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>رقم الطلب:</span><b style="color:var(--accent)">' + o.order_number + '</b></div>' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>الزبون:</span><span>' + o.customer_name + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span>الولاية:</span><span>' + o.city + '</span></div>' +
          '<div style="border-top:1px dashed var(--border);padding-top:8px;margin-top:6px;font-size:11px;color:var(--text-muted)">المنتجات المطلوبة:</div>' +
          itemsHtml +
          '<div style="display:flex;justify-content:space-between;border-top:1px dashed var(--border);padding-top:8px;margin-top:6px;font-size:15px;font-weight:900"><span>المجموع الصافي:</span><span style="color:var(--accent)">' + o.total_tnd + ' DT</span></div>';
      }
      modal.classList.add('open');
    },

    closeSuccessModal: function() {
      var modal = document.getElementById('darnaCartSuccessModal');
      if (modal) modal.classList.remove('open');
    },

    injectUI: function() {
      if (document.getElementById('darnaCartDrawer')) return;

      // Inject Drawer Styles
      var style = document.createElement('style');
      style.textContent = `
        /* ===== DARNA LUXURY PANIER DRAWER ===== */
        .darna-cart-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          z-index: 10000;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.3s;
        }
        .darna-cart-overlay.open {
          opacity: 1;
          visibility: visible;
        }
        .darna-cart-drawer {
          position: fixed;
          top: 0;
          bottom: 0;
          left: 0;
          width: 100%;
          max-width: 440px;
          background: var(--bg-card, #ffffff);
          color: var(--text-primary, #1c1917);
          z-index: 10001;
          display: flex;
          flex-direction: column;
          box-shadow: -10px 0 35px rgba(0, 0, 0, 0.25);
          transform: translateX(-105%);
          transition: transform 0.38s cubic-bezier(0.16, 1, 0.3, 1);
          direction: rtl;
        }
        [dir="ltr"] .darna-cart-drawer {
          left: auto;
          right: 0;
          transform: translateX(105%);
        }
        .darna-cart-drawer.open {
          transform: translateX(0);
        }
        .darna-cart-header {
          padding: 18px 20px;
          border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.08));
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--bg-elevated, #faf8f5);
        }
        .darna-cart-header-title {
          font-size: 16px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--text-primary, #1c1917);
        }
        .darna-cart-close-btn {
          background: none;
          border: none;
          font-size: 22px;
          color: var(--text-muted, #78716c);
          cursor: pointer;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        .darna-cart-close-btn:hover {
          background: var(--border, rgba(0,0,0,0.06));
          color: var(--text-primary, #1c1917);
        }
        .darna-ship-bar-wrap {
          padding: 10px 18px;
          background: rgba(183, 101, 67, 0.08);
          border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.08));
        }
        .darna-ship-bar-wrap.success {
          background: rgba(16, 185, 129, 0.1);
        }
        .darna-ship-bar-text {
          font-size: 11.5px;
          color: var(--text-primary, #1c1917);
          margin-bottom: 6px;
        }
        .darna-ship-bar-track {
          width: 100%;
          height: 6px;
          border-radius: 999px;
          background: var(--border, rgba(0, 0, 0, 0.1));
          overflow: hidden;
        }
        .darna-ship-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--accent, #b76543), #10b981);
          border-radius: 999px;
          transition: width 0.4s ease;
        }
        .darna-cart-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .darna-cart-item {
          display: flex;
          gap: 12px;
          align-items: center;
          background: var(--bg-elevated, #faf8f5);
          border: 1px solid var(--border, rgba(0, 0, 0, 0.08));
          border-radius: 12px;
          padding: 12px;
          position: relative;
          transition: all 0.2s ease;
        }
        .darna-cart-item:hover {
          border-color: var(--accent, #b76543);
          box-shadow: 0 2px 10px rgba(0,0,0,0.04);
        }
        .darna-cart-item-img {
          width: 64px;
          height: 64px;
          border-radius: 10px;
          overflow: hidden;
          background: #fff;
          border: 1px solid var(--border, rgba(0,0,0,0.08));
          flex-shrink: 0;
        }
        .darna-cart-item-img img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .darna-cart-item-info {
          flex: 1;
          min-width: 0;
        }
        .darna-cart-item-title {
          font-size: 13.5px;
          font-weight: 800;
          color: var(--text-primary, #1c1917);
          line-height: 1.3;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .darna-cart-item-variants {
          display: flex;
          gap: 6px;
          margin-top: 4px;
          flex-wrap: wrap;
        }
        .darna-pill-variant {
          font-size: 10.5px;
          background: var(--accent-glow, rgba(183,101,67,0.12));
          color: var(--accent, #b76543);
          padding: 1px 7px;
          border-radius: 4px;
          font-weight: 700;
        }
        .darna-cart-item-price-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 8px;
        }
        .darna-cart-item-price {
          font-size: 14.5px;
          font-weight: 900;
          color: var(--accent, #b76543);
        }
        .darna-cart-qty-stepper {
          display: flex;
          align-items: center;
          background: var(--bg-card, #ffffff);
          border: 1px solid var(--border, rgba(0,0,0,0.12));
          border-radius: 20px;
          overflow: hidden;
        }
        .darna-cart-qty-btn {
          width: 28px;
          height: 28px;
          background: none;
          border: none;
          color: var(--text-primary, #1c1917);
          font-size: 16px;
          font-weight: bold;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s;
        }
        .darna-cart-qty-btn:hover {
          background: var(--border, rgba(0,0,0,0.06));
        }
        .darna-cart-qty-val {
          padding: 0 8px;
          font-size: 12px;
          font-weight: 800;
        }
        .darna-cart-item-remove {
          background: none;
          border: none;
          color: #ef4444;
          cursor: pointer;
          padding: 6px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0.6;
          transition: opacity 0.2s;
        }
        .darna-cart-item-remove:hover {
          opacity: 1;
          background: rgba(239, 68, 68, 0.1);
        }
        .darna-cart-empty-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 40px 20px;
          gap: 12px;
          color: var(--text-muted, #78716c);
        }
        .darna-cart-empty-box svg {
          opacity: 0.35;
          margin-bottom: 6px;
        }
        .darna-cart-footer {
          border-top: 1px solid var(--border, rgba(0, 0, 0, 0.08));
          padding: 16px 20px;
          background: var(--bg-elevated, #faf8f5);
          box-shadow: 0 -4px 16px rgba(0,0,0,0.04);
        }
        .darna-cart-line {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
          color: var(--text-secondary, #44403c);
          margin-bottom: 6px;
        }
        .darna-cart-line.total {
          border-top: 1px dashed var(--border, rgba(0,0,0,0.12));
          padding-top: 8px;
          margin-top: 8px;
          font-size: 16px;
          font-weight: 900;
          color: var(--text-primary, #1c1917);
        }
        .darna-cart-line.total .val {
          color: var(--accent, #b76543);
          font-size: 19px;
        }
        .darna-cart-checkout-box {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--border, rgba(0,0,0,0.08));
        }
        .darna-cart-form-field {
          width: 100%;
          height: 40px;
          background: var(--bg-card, #ffffff);
          border: 1px solid var(--border, rgba(0,0,0,0.14));
          border-radius: 8px;
          padding: 0 12px;
          font-size: 12.5px;
          color: var(--text-primary, #1c1917);
          font-family: inherit;
          margin-bottom: 8px;
          box-sizing: border-box;
        }
        .darna-cart-btn-primary {
          width: 100%;
          height: 48px;
          background: linear-gradient(135deg, var(--accent, #b76543), #a0522d);
          color: #ffffff;
          border: none;
          border-radius: 24px;
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          box-shadow: 0 4px 16px rgba(183, 101, 67, 0.3);
          transition: all 0.2s;
        }
        .darna-cart-btn-primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(183, 101, 67, 0.4);
        }
        .darna-cart-btn-wa {
          width: 100%;
          height: 42px;
          background: transparent;
          color: #25D366;
          border: 1.5px solid #25D366;
          border-radius: 24px;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 8px;
          transition: all 0.2s;
        }
        .darna-cart-btn-wa:hover {
          background: rgba(37, 211, 102, 0.08);
        }
        .darna-cart-toast {
          position: fixed;
          bottom: 80px;
          right: 20px;
          left: 20px;
          max-width: 380px;
          margin: 0 auto;
          background: #1c1917;
          color: #ffffff;
          padding: 12px 18px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 700;
          z-index: 10002;
          box-shadow: 0 8px 24px rgba(0,0,0,0.25);
          transform: translateY(40px);
          opacity: 0;
          pointer-events: none;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          text-align: center;
          direction: rtl;
        }
        .darna-cart-toast.show {
          transform: translateY(0);
          opacity: 1;
        }
        .cart-count-badge {
          display: none;
          align-items: center;
          justify-content: center;
          background: #ef4444;
          color: #fff;
          font-size: 11px;
          font-weight: 900;
          min-width: 18px;
          height: 18px;
          border-radius: 9px;
          padding: 0 4px;
          position: absolute;
          top: -4px;
          right: -4px;
          line-height: 1;
          box-shadow: 0 2px 6px rgba(239, 68, 68, 0.4);
        }
      `;
      document.head.appendChild(style);

      // Inject Overlay
      var overlay = document.createElement('div');
      overlay.id = 'darnaCartOverlay';
      overlay.className = 'darna-cart-overlay';
      overlay.onclick = function() { DarnaCart.close(); };
      document.body.appendChild(overlay);

      // Inject Drawer HTML
      var drawer = document.createElement('div');
      drawer.id = 'darnaCartDrawer';
      drawer.className = 'darna-cart-drawer';
      drawer.innerHTML = `
        <div class="darna-cart-header">
          <div class="darna-cart-header-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            <span>سلة المشتريات</span>
            <span id="darnaCartHeaderCount" style="color:var(--accent);font-size:14px;font-weight:800">(0)</span>
          </div>
          <button type="button" class="darna-cart-close-btn" onclick="DarnaCart.close()" aria-label="إغلاق">✕</button>
        </div>

        <div id="darnaCartShippingBanner" style="display:none"></div>

        <div class="darna-cart-body" id="darnaCartItemsList">
          <!-- Dynamic Items -->
        </div>

        <div class="darna-cart-empty-box" id="darnaCartEmpty" style="display:flex">
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          <div style="font-weight:800;font-size:15px;color:var(--text-primary)">سلتك فارغة حالياً</div>
          <p style="font-size:12px;margin:0">اختر مقاسات ونماذج المهراس أو المنتجات التونسية المفضلة لديك وأضفها للسلة.</p>
          <button type="button" class="darna-cart-btn-primary" style="height:40px;width:auto;padding:0 24px;margin-top:6px" onclick="DarnaCart.close()">تصفح المنتجات</button>
        </div>

        <div class="darna-cart-footer" id="darnaCartSummary" style="display:none">
          <div class="darna-cart-line">
            <span>سعر المنتجات:</span>
            <span id="darnaCartSubtotalVal" style="font-weight:700">0.00 DT</span>
          </div>
          <div class="darna-cart-line">
            <span>مصاريف التوصيل:</span>
            <span id="darnaCartDeliveryVal" style="font-weight:700">0.00 DT</span>
          </div>
          <div class="darna-cart-line total">
            <span>المجموع الصافي:</span>
            <span class="val" id="darnaCartTotalVal">0.00 DT</span>
          </div>

          <form class="darna-cart-checkout-box" onsubmit="return DarnaCart.submitCartOrder(event)">
            <div style="font-size:12px;font-weight:800;margin-bottom:8px;color:var(--text-primary)">بيانات التوصيل السريع (الدفع عند الاستلام):</div>
            <input type="text" id="cartCustName" class="darna-cart-form-field" placeholder="الاسم واللقب بالكامل *" required />
            <input type="tel" id="cartCustPhone" class="darna-cart-form-field" placeholder="رقم الهاتف الجوال (مثال: 98123456) *" required />
            <select id="cartCustCity" class="darna-cart-form-field" required>
              <option value="" disabled selected>اختر الولاية...</option>
              ${TUNISIAN_CITIES.map(function(c){ return '<option value="' + c + '">' + c + '</option>'; }).join('')}
            </select>
            <input type="text" id="cartCustAddress" class="darna-cart-form-field" placeholder="العنوان بالتفصيل (المدينة، الحي...)" />

            <button type="submit" class="darna-cart-btn-primary">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
              <span>تأكيد طلب السلة الآن (الدفع عند الاستلام)</span>
            </button>
            <button type="button" class="darna-cart-btn-wa" onclick="DarnaCart.orderViaWhatsApp()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2ZM12.05 20.15C10.57 20.15 9.12 19.75 7.85 19L7.55 18.82L4.43 19.64L5.26 16.59L5.06 16.28C4.24 14.97 3.81 13.46 3.81 11.91C3.81 7.37 7.5 3.68 12.05 3.68C14.25 3.68 16.32 4.54 17.88 6.1C19.43 7.66 20.29 9.72 20.29 11.92C20.28 16.46 16.59 20.15 12.05 20.15ZM16.57 14.33C16.32 14.21 15.11 13.61 14.88 13.53C14.66 13.44 14.49 13.4 14.33 13.65C14.16 13.9 13.68 14.46 13.53 14.63C13.38 14.79 13.23 14.82 12.98 14.69C12.73 14.57 11.93 14.31 10.98 13.46C10.24 12.8 9.74 11.99 9.6 11.74C9.45 11.49 9.58 11.36 9.71 11.23C9.82 11.12 9.96 10.94 10.08 10.8C10.21 10.65 10.25 10.55 10.33 10.38C10.41 10.22 10.37 10.07 10.31 9.95C10.25 9.82 9.75 8.6 9.55 8.09C9.35 7.59 9.14 7.66 8.98 7.65C8.83 7.64 8.66 7.64 8.49 7.64C8.32 7.64 8.04 7.7 7.82 7.95C7.59 8.2 6.94 8.81 6.94 10.05C6.94 11.29 7.84 12.49 7.97 12.66C8.09 12.82 9.75 15.39 12.29 16.48C12.89 16.74 13.36 16.9 13.72 17.01C14.33 17.21 14.88 17.18 15.32 17.11C15.81 17.04 16.82 16.5 17.03 15.91C17.24 15.31 17.24 14.81 17.17 14.69C17.11 14.57 16.96 14.46 16.57 14.33Z"/></svg>
              <span>طلب السلة عبر واتساب</span>
            </button>
          </form>
        </div>
      `;
      document.body.appendChild(drawer);

      // Inject Cart Success Modal
      var successModal = document.createElement('div');
      successModal.id = 'darnaCartSuccessModal';
      successModal.className = 'modal-wrap';
      successModal.innerHTML = `
        <div class="modal-card">
          <div class="success-tick">✓</div>
          <h3 style="font-size:20px;font-weight:900;margin-bottom:6px">تم تسجيل طلب السلة بنجاح!</h3>
          <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px">شكراً لثقتك في متجر دارنا. تم تسجيل جميع المنتجات والمقاسات المطلوبة، وسنتصل بك قريباً للتسليم.</p>
          <div id="darnaCartSuccessSummary" style="background:var(--bg-elevated);padding:14px;border-radius:10px;text-align:right;font-size:13px;margin-bottom:18px;border:1px solid var(--border)"></div>
          <button class="pill-buy-btn" style="width:100%" onclick="DarnaCart.closeSuccessModal()">حسناً، متابعة التسوق</button>
        </div>
      `;
      document.body.appendChild(successModal);

      this.updateBadges();
      this.render();
    },

    init: function() {
      var self = this;
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { self.injectUI(); });
      } else {
        self.injectUI();
      }
      window.addEventListener('storage', function(e) {
        if (e.key === CART_KEY) {
          self.updateBadges();
          self.render();
        }
      });
    }
  };

  DarnaCart.init();
})();
