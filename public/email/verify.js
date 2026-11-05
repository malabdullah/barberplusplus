import { verificationUrl } from './verification-url.js';

let language = 'en';
try {
  language = (localStorage.getItem('barber-language') || navigator.language).startsWith('ar') ? 'ar' : 'en';
  const theme = localStorage.getItem('barber-theme');
  if (['light', 'dark'].includes(theme)) document.documentElement.dataset.theme = theme;
} catch { /* Private browsing may disable storage. */ }
const ar = language === 'ar';
document.documentElement.lang = language;
document.documentElement.dir = ar ? 'rtl' : 'ltr';
const heading = document.querySelector('h1');
const message = document.querySelector('#message');
const button = document.querySelector('#continue');
const back = document.querySelector('#back');
function showLink() {
  button.hidden = true;
  button.disabled = false;
  button.onclick = null;
  message.removeAttribute('role');
  let result;
  try { result = verificationUrl(window.location.href, window.__BARBER_CONFIG__ || {}); } catch { /* Show a safe retry without displaying the token. */ }
  window.history.replaceState(null, '', window.location.pathname);
  back.href = result?.customer ? '/customer/sign-in' : '/login';
  back.textContent = ar ? 'العودة إلى تسجيل الدخول' : 'Back to sign in';
  if (result) {
    const reset = result.type === 'recovery';
    heading.textContent = reset ? (ar ? 'إعادة تعيين كلمة المرور' : 'Reset your password') : (ar ? 'تأكيد بريدك الإلكتروني' : 'Confirm your email');
    message.textContent = ar ? 'اضغط على متابعة لإكمال طلبك بأمان في Barber++.' : 'Continue to securely complete your request with Barber++.';
    button.textContent = ar ? 'متابعة' : 'Continue';
    button.hidden = false;
    button.onclick = () => {
      button.disabled = true;
      button.textContent = ar ? 'جارٍ المتابعة…' : 'Continuing…';
      window.location.replace(result.url);
    };
  } else {
    heading.textContent = ar ? 'رابط غير صالح' : 'This link is incomplete';
    message.textContent = ar ? 'افتح الرابط الكامل من أحدث رسالة. يمكنك طلب رسالة جديدة من صفحة تسجيل الدخول.' : 'Open the full link from your latest email. You can request a new email from the sign-in page.';
    message.setAttribute('role', 'alert');
  }
  document.title = `${heading.textContent} | Barber++`;
}
window.addEventListener('hashchange', showLink);
showLink();
