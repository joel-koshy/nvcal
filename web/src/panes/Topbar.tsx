import { useState, useContext } from 'preact/hooks';
import { VimContext } from '@/hooks/vim/VimProvider';
import { usePane } from '@/hooks/vim/usePane';
import { useNavigable } from '@/hooks/vim/useNavigable';
import { VimDialog, VimFormRow } from '@/components/DialogBox';
import { api } from '@/utils/api';

import type { ApiResponse } from '@/types/api';

function AuthButton({ onActivate }: { onActivate: () => void }) {
  const vimRef = useNavigable<HTMLButtonElement>('topbar');

  return (
    <button
      ref={vimRef}
      class="topbar-btn"
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'i') {
          e.preventDefault();
          e.stopPropagation();
          onActivate();
        }
      }}
    >
      Login / Sign Up
    </button>
  );
}

interface TopbarProps {
  currentDate: Date;
}

type AuthTab = 'login' | 'signup';

export function Topbar({ currentDate }: TopbarProps) {
  const vimContext = useContext(VimContext);
  const [showAuth, setShowAuth] = useState(false);
  const [authTab, setAuthTab] = useState<AuthTab>('login');
  const [loggedIn, setLoggedIn] = useState(false);
  const [authError, setAuthError] = useState('');

  usePane('topbar', {
    cols: 1,
    flow: 'col',
    neighbors: { left: 'sidebar', down: 'main' }
  });

  const openAuth = () => {
    setShowAuth(true);
    setAuthError('');
    setAuthTab('login');
    vimContext?.setActivePane('login-dialog');
    setTimeout(() => {
      const input = document.querySelector('#login-dialog input') as HTMLElement;
      if (input) input.focus();
    }, 0);
  };

  const closeAuth = () => {
    setShowAuth(false);
    vimContext?.setActivePane('topbar');
    setTimeout(() => {
      const btn = document.querySelector('.topbar-btn') as HTMLElement;
      if (btn) btn.focus();
    }, 0);
  };

  const handleLogin = async (e: SubmitEvent) => {
    e.preventDefault();
    setAuthError('');
    const form = e.currentTarget as HTMLFormElement;
    const data = new FormData(form);

    try {
      await api<ApiResponse<'/auth/login POST'>>('/auth/login', 'POST', {
        email: data.get('email'),
        password: data.get('password'),
      });
      setLoggedIn(true);
      setShowAuth(false);
      vimContext?.setActivePane('main');
    } catch (err: any) {
      setAuthError(err.message || 'Login failed');
    }
  };

  const handleSignup = async (e: SubmitEvent) => {
    e.preventDefault();
    setAuthError('');
    const form = e.currentTarget as HTMLFormElement;
    const data = new FormData(form);

    const password = data.get('password');
    const confirmPassword = data.get('confirmPassword');

    if (password !== confirmPassword) {
      setAuthError('Passwords do not match');
      return;
    }

    try {
      await api<ApiResponse<'/auth/signup POST'>>('/auth/signup', 'POST', {
        email: data.get('email'),
        password,
      });
      setLoggedIn(true);
      setShowAuth(false);
      vimContext?.setActivePane('main');
    } catch (err: any) {
      setAuthError(err.message || 'Signup failed');
    }
  };

  return (
    <>
      <header class="topbar">
        <h2>Week of {currentDate.toLocaleDateString()}</h2>

        {!loggedIn && (
          <AuthButton onActivate={openAuth} />
        )}
      </header>

      <VimDialog
        isOpen={showAuth}
        title={authTab === 'login' ? 'Login' : 'Sign Up'}
        id="login-dialog"
        paneName="login-dialog"
        onClose={closeAuth}
        onSubmit={authTab === 'login' ? handleLogin : handleSignup}
      >
        <VimFormRow
          paneName="login-dialog"
          onClickAction={() => setAuthTab(authTab === 'login' ? 'signup' : 'login')}
        >
          <div class="auth-tabs">
            <button
              type="button"
              class={`auth-tab ${authTab === 'login' ? 'active' : ''}`}
              onClick={() => setAuthTab('login')}
            >
              Login
            </button>
            <button
              type="button"
              class={`auth-tab ${authTab === 'signup' ? 'active' : ''}`}
              onClick={() => setAuthTab('signup')}
            >
              Sign Up
            </button>
          </div>
        </VimFormRow>

        {authError && <div class="auth-error">{authError}</div>}

        {authTab === 'login' ? (
          <>
            <VimFormRow paneName="login-dialog">
              <label>Email</label>
              <input name="email" type="email" placeholder="user@example.com" />
            </VimFormRow>

            <VimFormRow paneName="login-dialog">
              <label>Password</label>
              <input name="password" type="password" placeholder="••••••••" />
            </VimFormRow>

            <VimFormRow paneName="login-dialog">
              <button class="save-btn" type="submit">Login</button>
            </VimFormRow>
          </>
        ) : (
          <>
            <VimFormRow paneName="login-dialog">
              <label>Email</label>
              <input name="email" type="email" placeholder="user@example.com" />
            </VimFormRow>

            <VimFormRow paneName="login-dialog">
              <label>Password</label>
              <input name="password" type="password" placeholder="••••••••" />
            </VimFormRow>

            <VimFormRow paneName="login-dialog">
              <label>Confirm Password</label>
              <input name="confirmPassword" type="password" placeholder="••••••••" />
            </VimFormRow>

            <VimFormRow paneName="login-dialog">
              <button class="save-btn" type="submit">Sign Up</button>
            </VimFormRow>
          </>
        )}

        <hr style={{ width: '70%' }} />

        <VimFormRow paneName="login-dialog">
          <a href="/auth/google/login" class="oauth-btn">Sign in with Google</a>
        </VimFormRow>

        <VimFormRow paneName="login-dialog">
          <a class="oauth-btn">Sign in with Outlook</a>
        </VimFormRow>

        <VimFormRow paneName="login-dialog">
          <a class="oauth-btn">Sign in with Apple</a>
        </VimFormRow>
      </VimDialog>
    </>
  );
}
