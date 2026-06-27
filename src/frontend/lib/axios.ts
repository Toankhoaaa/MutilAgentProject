import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.data?.error?.type === 'reauth_required') {
      window.location.href = '/api/v1/auth/login';
    }
    return Promise.reject(error);
  }
);

export default api;
