import { useAuthStore } from "@/stores/auth-store";

export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  const setError = useAuthStore((s) => s.setError);

  return {
    user,
    status,
    error,
    login,
    logout,
    setError,
    isAuthenticated: status === "authenticated" && !!user,
    isInitializing: status === "initializing",
  };
}

export function useRequireAuth() {
  const auth = useAuth();
  return auth;
}
