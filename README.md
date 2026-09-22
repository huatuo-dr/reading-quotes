# reading-quotes

个人读书摘抄：好看的首页轮播 + 单用户后台 CRUD。数据在 `data/quotes.json`，改完可自动 `git commit` & `push`。

## 本地开发

```bash
cp .env.example .env
npm install
npm run dev
```

- 前端：http://127.0.0.1:5173 （代理 `/api` → 3000）
- API：http://127.0.0.1:3000

默认本地 `.env` 可把 `GIT_ENABLED=false`。

## 文档

- [设计方案与技术路线](docs/01-设计方案与技术路线.md)
- [部署指导](docs/02-部署指导.md)

## 生产

```bash
./deploy.sh
```
