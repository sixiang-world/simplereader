---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 1b15fa6152c39e6cbe05d76c27235a71_271f84b7725211f1b2f55254006c9bbf
    ReservedCode1: AKqbkOHrwS+XrteFNm/tWQRxKNsU2MTbtCr4O85LQYtEHZfgibtrE3TOWjIOn8xFJn9xBxria9YRJ0dOg3Wgd8g27CC/+Ae7yrpqH9Z/+6BtJhvL7/bxC3nhjOuWYl+oX7RRPNg/cnK2lLOXIIr8Kjbxay14sV1LT9temznV3gXk6TUoCkXU7g8dZb4=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 1b15fa6152c39e6cbe05d76c27235a71_271f84b7725211f1b2f55254006c9bbf
    ReservedCode2: AKqbkOHrwS+XrteFNm/tWQRxKNsU2MTbtCr4O85LQYtEHZfgibtrE3TOWjIOn8xFJn9xBxria9YRJ0dOg3Wgd8g27CC/+Ae7yrpqH9Z/+6BtJhvL7/bxC3nhjOuWYl+oX7RRPNg/cnK2lLOXIIr8Kjbxay14sV1LT9temznV3gXk6TUoCkXU7g8dZb4=
---



# SimpleTextReader 开发计划

## 待办

- [ ] **自动繁体转简体** — 打开繁体书时自动转换为简体中文，通过 `file:afterProcess` Hook 挂载简繁映射表实现，无感知
- [ ] **排版预设快捷切换** — 保存多套排版配置为预设方案，支持通过快捷参数切换（如 `scheme=1` 切到方案1、`scheme=夜间` 按名称切换），切换后即时应用对应字体/字号/行距/主题等全套配置
- [ ] **后端功能前端化** — ① books_one 的书改为 `npm run build` 时手动预处理分页后静态托管，不再由后端运行时处理；② 移除后端静态文件托管（改用 EdgeOne Pages）；③ 暂弃 WebSocket；④ 运行时配置同步改用 textdb.hunluan.space，通过关键词绑定实现多设备配置同步；⑤ 移除字体管理功能
