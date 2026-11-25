/* ==========================================================================
   honey — script.js (ใช้ร่วมกันทุกหน้า)

   ID ที่ไฟล์นี้ใช้:
   - product.html : #filter-bar, #product-list
   - order.html   : #orderForm, #customerName, #contact, #items, #total, #note
   - admin.html   : #ordersTable  (เขียนแถวลงใน #ordersTable tbody)

   สคริปต์ตรวจจากการมีอยู่ของ element ในหน้า จึงใส่ไฟล์เดียวได้ทุกหน้า
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------------
     ค่าคงที่
     ------------------------------------------------------------------------ */
  var PRODUCTS_URL = 'products.json';
  var ORDER_PAGE = 'order.html';
  var CSV_URL =
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vSahIlMoJh98_u6wQn2sVIHyU3DpnWXxC0xhZcHtcm82BXUj5DAO_KFqh1IsylEBI5hr0DLNlOITT5M/pub?gid=0&single=true&output=csv';
  var SCRIPT_URL =
    'https://script.google.com/macros/s/AKfycbx7t60HaZj2_ssvWTkA04N9pZoXsUiAmdcAxRMYtFgOZ1OSj0Qm0oppKnTF01G2F9px5w/exec';

  /* ------------------------------------------------------------------------
     ตัวช่วยเล็กๆ
     ------------------------------------------------------------------------ */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text; // textContent = กัน XSS
    return node;
  }

  function normalize(str) {
    return String(str || '').toLowerCase().replace(/\s+/g, '');
  }

  function formatPrice(n) {
    return Number(n).toLocaleString('th-TH');
  }

  /* ========================================================================
     1) หน้า product.html — การ์ดสินค้า + ตัวกรองตามไซส์
     ======================================================================== */
  function initProductPage() {
    var list = document.getElementById('product-list');
    var filterBar = document.getElementById('filter-bar');
    if (!list || !filterBar) return;

    var products = [];
    var activeFilter = 'all';

    function buildCard(p) {
      var card = el('article', 'product');

      var media = el('div', 'product__media');
      var img = document.createElement('img');
      img.src = p.image;
      img.alt = p.name + ' ' + p.size;
      img.loading = 'lazy';
      media.appendChild(img);

      var body = el('div', 'product__body');
      body.appendChild(el('h3', 'product__name', p.name));
      body.appendChild(el('p', 'product__size', p.size));

      var price = el('p', 'product__price', formatPrice(p.price) + ' ');
      price.appendChild(el('small', '', 'บาท'));
      body.appendChild(price);

      // ส่งชื่อสินค้า (ชื่อ + ไซส์) และราคา ไปหน้า order ผ่าน URL parameter
      var params = new URLSearchParams();
      params.set('item', p.name + ' ' + p.size);
      params.set('price', p.price);

      var btn = el('a', 'btn btn--solid btn--block', 'สั่งซื้อ');
      btn.href = ORDER_PAGE + '?' + params.toString();
      body.appendChild(btn);

      card.appendChild(media);
      card.appendChild(body);
      return card;
    }

    function renderProducts() {
      list.innerHTML = '';
      var shown = products.filter(function (p) {
        return activeFilter === 'all' || p.size === activeFilter;
      });

      if (!shown.length) {
        list.appendChild(el('p', 'muted', 'ไม่พบสินค้าในหมวดนี้'));
        return;
      }
      shown.forEach(function (p) {
        list.appendChild(buildCard(p));
      });
    }

    function renderFilterBar() {
      filterBar.innerHTML = '';

      var sizes = [];
      products.forEach(function (p) {
        if (sizes.indexOf(p.size) === -1) sizes.push(p.size);
      });

      var options = [{ value: 'all', label: 'ทั้งหมด' }].concat(
        sizes.map(function (s) {
          return { value: s, label: s };
        })
      );

      options.forEach(function (opt) {
        var b = el('button', 'btn', opt.label);
        b.type = 'button';
        b.dataset.filter = opt.value;
        b.addEventListener('click', function () {
          setFilter(opt.value);
        });
        filterBar.appendChild(b);
      });
    }

    function setFilter(value) {
      activeFilter = value;
      Array.prototype.forEach.call(filterBar.children, function (b) {
        var on = b.dataset.filter === value;
        b.classList.toggle('btn--solid', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      renderProducts();
    }

    // ?mood=xxx → หาสินค้าที่ตรงกับ size / id / ชื่อ แล้วกรองตามไซส์ของสินค้านั้น
    function filterFromMood() {
      var mood = normalize(new URLSearchParams(window.location.search).get('mood'));
      if (!mood) return 'all';

      var hit = products.filter(function (p) {
        return (
          normalize(p.size).indexOf(mood) !== -1 ||
          normalize(p.id).indexOf(mood) !== -1 ||
          normalize(p.name).indexOf(mood) !== -1
        );
      })[0];

      return hit ? hit.size : 'all';
    }

    fetch(PRODUCTS_URL)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        products = data;
        renderFilterBar();
        setFilter(filterFromMood());
      })
      .catch(function (error) {
        console.error(error);
        list.innerHTML = '';
        list.appendChild(el('p', 'form__message--error', 'โหลดข้อมูลสินค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
      });
  }

  /* ========================================================================
     2) หน้า order.html — เติมฟอร์มอัตโนมัติ + ส่งข้อมูลเข้า Apps Script
     ======================================================================== */
  function initOrderPage() {
    var form = document.getElementById('orderForm');
    if (!form) return;

    // เติมจาก URL parameter ทันทีที่โหลดหน้า — ทั้ง items และ total
    var params = new URLSearchParams(window.location.search);
    var itemField = document.getElementById('items');
    var totalField = document.getElementById('total');

    var item = params.get('item');
    var price = params.get('price');

    if (itemField && item !== null) itemField.value = item;
    if (totalField && price !== null) totalField.value = price;

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      var payload = {
        customerName: document.getElementById('customerName').value.trim(),
        contact: document.getElementById('contact').value.trim(),
        items: document.getElementById('items').value.trim(),
        total: document.getElementById('total').value.trim(),
        note: document.getElementById('note').value.trim()
      };

      var submitBtn = form.querySelector('[type="submit"]');
      if (submitBtn) submitBtn.disabled = true; // กันกดซ้ำ

      fetch(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify(payload)
      })
        .then(() => { window.location.href = 'thankyou.html'; })
        .catch(error => {
          console.error(error);
          if (submitBtn) submitBtn.disabled = false;
          alert('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
        });
    });
  }

  /* ========================================================================
     3) หน้า admin.html — อ่าน CSV จาก Google Sheet แสดงเป็นตาราง
     ======================================================================== */

  // parse CSV เอง: รองรับเครื่องหมายคำพูด, "" (quote ซ้อน), ขึ้นบรรทัดใหม่ในช่อง, CRLF
  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;

    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // ตัด BOM

    for (var i = 0; i < text.length; i++) {
      var c = text[i];

      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }

    // แถวสุดท้ายที่ไม่มี newline ปิดท้าย
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }

    // ตัดแถวว่างทิ้ง
    return rows.filter(function (r) {
      return r.some(function (cell) {
        return cell.trim() !== '';
      });
    });
  }

  function initAdminPage() {
    var tbody = document.querySelector('#ordersTable tbody');
    if (!tbody) return;

    var COLS = 6; // วันเวลา, ชื่อ, เบอร์/Line, รายการ, ยอดรวม, หมายเหตุ

    function showMessage(text, isError) {
      tbody.innerHTML = '';
      var tr = document.createElement('tr');
      var td = el('td', isError ? 'form__message--error' : 'muted', text);
      td.colSpan = COLS;
      td.style.textAlign = 'center';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }

    showMessage('กำลังโหลดข้อมูล…', false);

    fetch(CSV_URL)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var rows = parseCSV(text);

        // ถ้าแถวแรกเป็นหัวตาราง (ไม่ใช่วันที่) ให้ข้าม
        if (rows.length && !/\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}/.test(rows[0][0])) {
          rows.shift();
        }

        // appendRow ต่อท้ายเสมอ → กลับลำดับให้รายการล่าสุดอยู่บนสุด
        rows.reverse();

        if (!rows.length) {
          showMessage('ยังไม่มีคำสั่งซื้อ', false);
          return;
        }

        tbody.innerHTML = '';
        rows.forEach(function (r) {
          var tr = document.createElement('tr');
          for (var i = 0; i < COLS; i++) {
            tr.appendChild(el('td', '', r[i] !== undefined ? r[i] : ''));
          }
          tbody.appendChild(tr);
        });
      })
      .catch(function (error) {
        console.error(error);
        showMessage('โหลดข้อมูลคำสั่งซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', true);
      });
  }

  /* ------------------------------------------------------------------------
     เริ่มทำงาน
     ------------------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', function () {
    initProductPage();
    initOrderPage();
    initAdminPage();
  });
})();
