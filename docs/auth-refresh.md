# Auth (Access + Refresh Tokens)

This backend issues:

- **Access token** (short-lived): returned in JSON as `accessToken` (also mirrored as `token`)
- **Refresh token** (long-lived): stored in an **httpOnly cookie** and used by `POST /api/auth/refresh`

To use refresh cookies from a Vite/React frontend:

- Backend `.env`: set `CORS_ORIGIN` to your frontend origin (not `*`)
- Axios: set `withCredentials: true`

## Frontend (Vite + Axios) example

`src/lib/api.js`:

```js
import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5001/api";

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true
});

let accessToken = localStorage.getItem("accessToken");

export const setAccessToken = (token) => {
  accessToken = token || "";
  if (accessToken) localStorage.setItem("accessToken", accessToken);
  else localStorage.removeItem("accessToken");
};

api.interceptors.request.use((config) => {
  if (!config.headers) config.headers = {};
  if (accessToken && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

let isRefreshing = false;
let refreshQueue = [];

const resolveQueue = (error, token) => {
  for (const p of refreshQueue) {
    if (error) p.reject(error);
    else p.resolve(token);
  }
  refreshQueue = [];
};

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error?.response?.status;
    const original = error?.config;
    if (!original || status !== 401) return Promise.reject(error);

    // Don’t refresh in a loop.
    if (original._retry) return Promise.reject(error);

    // If refresh itself fails, force logout.
    if (String(original.url || "").includes("/auth/refresh")) {
      setAccessToken("");
      return Promise.reject(error);
    }

    original._retry = true;

    if (isRefreshing) {
      return new Promise((resolve, reject) => refreshQueue.push({ resolve, reject })).then(
        (newToken) => {
          original.headers.Authorization = `Bearer ${newToken}`;
          return api(original);
        }
      );
    }

    isRefreshing = true;
    try {
      const { data } = await api.post("/auth/refresh");
      const newToken = data?.accessToken;
      if (!newToken) throw new Error("Refresh response missing accessToken");

      setAccessToken(newToken);
      resolveQueue(null, newToken);

      original.headers.Authorization = `Bearer ${newToken}`;
      return api(original);
    } catch (refreshErr) {
      resolveQueue(refreshErr);
      setAccessToken("");
      return Promise.reject(refreshErr);
    } finally {
      isRefreshing = false;
    }
  }
);
```

### Login usage

```js
import { api, setAccessToken } from "./lib/api";

const { data } = await api.post("/auth/login", { username, password });
setAccessToken(data.accessToken);
```

### Logout usage

```js
import { api, setAccessToken } from "./lib/api";

await api.post("/auth/logout");
setAccessToken("");
```

