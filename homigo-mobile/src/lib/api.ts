import axios from "axios";

const API_BASE_URL = "http://localhost:3000/api";

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Services API
export const servicesAPI = {
  getAll: () => apiClient.get("/services"),
  getById: (id: string) => apiClient.get(`/services/${id}`),
};

// Bookings API
export const bookingsAPI = {
  create: (data: any) => apiClient.post("/bookings", data),
  getMyBookings: () => apiClient.get("/bookings/my-bookings"),
  updateStatus: (bookingId: string, status: string) =>
    apiClient.patch(`/bookings/${bookingId}`, { status }),
};

// Providers API
export const providersAPI = {
  search: (params: any) => apiClient.get("/providers/search", { params }),
  getById: (id: string) => apiClient.get(`/providers/${id}`),
};

// Payments API
export const paymentsAPI = {
  processPayment: (data: any) => apiClient.post("/payments/process", data),
  verifyPayment: (paymentId: string) =>
    apiClient.get(`/payments/verify/${paymentId}`),
};
