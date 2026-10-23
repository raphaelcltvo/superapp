---
updatedAt: 2026-05-07T14:11:22.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Cancelar pedido

É por meio deste endpoint será solicitado o cancelamento de um pedido que já foi enviado para o Sistema Saipos.

<br />

O cancelamento de pedidos existe para quando por algum motivo o cliente, no sistema do parceiro, desiste do pedido realizado.

Para estes casos, quando o pedido já foi integrado, é necessário obter o código do pedido na Saipos para realizar o cancelamento através do *endpoint* de cancelamento de pedido.

# OpenAPI definition

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "order-integration",
    "version": "2.5"
  },
  "servers": [
    {
      "url": "https://order-api.saipos.com"
    }
  ],
  "components": {
    "securitySchemes": {
      "sec0": {
        "type": "apiKey",
        "in": "query",
        "name": "api_key"
      }
    }
  },
  "security": [
    {
      "sec0": []
    }
  ],
  "paths": {
    "/cancel-order": {
      "post": {
        "summary": "Cancelar pedido",
        "description": "É por meio deste endpoint será solicitado o cancelamento de um pedido que já foi enviado para o Sistema Saipos.",
        "operationId": "cancel-order",
        "parameters": [
          {
            "name": "Authorization",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "Authorization",
            "in": "header",
            "description": "Neste campo é necessário informar o token gerado na rota de autenticação.",
            "schema": {
              "type": "string",
              "default": "aqui_vai_seu_token_gerado"
            }
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "order_id": {
                    "type": "string",
                    "description": "Id da sale que deseja cancelar"
                  },
                  "cod_store": {
                    "type": "string",
                    "default": "Codigo da loja do pedido"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{status: true}"
                  }
                }
              }
            }
          },
          "400": {
            "description": "400",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {}
                }
              }
            }
          }
        },
        "deprecated": false
      }
    }
  },
  "x-readme": {
    "headers": [],
    "explorer-enabled": true,
    "proxy-enabled": true
  },
  "x-readme-fauxas": true
}
```