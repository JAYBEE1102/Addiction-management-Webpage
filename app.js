let isSignUpMode = true;

const formTitle = document.getElementById('form-title');
const formSubtitle = document.getElementById('form-subtitle');
const submitBtn = document.getElementById('submit-btn');
const toggleText = document.getElementById('toggle-text');
const toggleBtn = document.getElementById('toggle-btn');
const passwordInput = document.getElementById('password');
const eyeBtn = document.getElementById('eye-btn');
const eyeSvg = document.getElementById('eye-svg');
const toast = document.getElementById('toast');

eyeBtn.addEventListener('click', () => {
    const isPassword = passwordInput.getAttribute('type') === 'password';
    passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
    
    if (isPassword) {
        eyeSvg.innerHTML = `
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
            <line x1="1" y1="1" x2="23" y2="23"></line>
        `;
    } else {
        eyeSvg.innerHTML = `
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
        `;
    }
});

function toggleAuthMode() {
    isSignUpMode = !isSignUpMode;
    
    if (isSignUpMode) {
        formTitle.textContent = 'Create an account';
        formSubtitle.textContent = 'Access your recovery tracker, daily journal, and support network anytime, anywhere - and keep everything flowing in one place.';
        submitBtn.textContent = 'Get Started';
        toggleText.textContent = "Don't have an account?";
        toggleBtn.textContent = 'Sign up';
    } else {
        formTitle.textContent = 'Welcome back';
        formSubtitle.textContent = 'Welcome back to JAYFOUND. Enter your credentials to access your personal recovery hub and daily check-ins.';
        submitBtn.textContent = 'Sign In';
        toggleText.textContent = 'Already have an account?';
        toggleBtn.textContent = 'Log in';
    }
}

function handleFormSubmit(event) {
    event.preventDefault();
    const email = document.getElementById('email').value;
    const message = isSignUpMode 
        ? `Welcome to JAYFOUND! Account created for ${email}.`
        : `Welcome back! Successfully logged into JAYFOUND.`;
        
    showToast(message);
}

function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 4000);
}
