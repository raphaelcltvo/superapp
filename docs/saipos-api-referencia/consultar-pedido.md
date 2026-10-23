---
updatedAt: 2026-07-02T19:35:44.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Consultar pedido de Mesa/Balcão

É por meio deste endpoint que poderá ser consultado o pedido de Mesa/Balcão.

<br />

#### Modelo de retorno da consulta

```json
{
    "customer": "PEDIDO DE TESTE - Jonathan Stein",
    "created_at": "2020-10-08T01:25:49.000Z",
    "notes": "",
    "totalDiscount": 0,
    "totalIncrease": 0,
    "discountReason": "",
    "increaseReason": "",
    "totalValue": 14.3,
    "totalItems": 13,
    "serviceFee": 10,
    "items": [
        {
            "desc_sale_item": "PEDIDO DE TESTE - PEQUENO",
            "quantity": 1,
            "unit_price": 13,
          	"deleted": "N",
            "choice_items": [
                {
                    "desc_sale_item_choice": "Massa massa doce + Borda normal",
                    "aditional_price": 3,
                  	"deleted": "N"
                },
                {
                    "desc_sale_item_choice": "Queijo",
                    "aditional_price": 10,
                  	"deleted": "N"
                }
            ]
        }
    ],
  	"paymentsAlreadyMade": [
        {
            "item": "PEDIDO DE TESTE - PEQUENO",
            "payment_amount": 13,
            "change_for": 0,
            "payment": "Pix"
        }
    ],
    " orderStatus":1
}
```

O campo "orderStatus" pode retornar o valor 1, 2 e 3. Sendo que os valores representam:

**1 quando a mesa/comanda estiver fechada.**

**2 quando estiver em consumo.**

**3 quando estiver em fechamento.**

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
    "/order": {
      "get": {
        "summary": "Consultar pedido de Mesa/Balcão",
        "description": "É por meio deste endpoint que poderá ser consultado o pedido de Mesa/Balcão.",
        "operationId": "consultar-pedido",
        "parameters": [
          {
            "name": "cod_store",
            "in": "query",
            "description": "Código da loja",
            "schema": {
              "type": "string",
              "default": "123"
            }
          },
          {
            "name": "order_id",
            "in": "query",
            "description": "Código do pedido",
            "schema": {
              "type": "string",
              "default": "12345678"
            }
          },
          {
            "name": "Authorization",
            "in": "header",
            "description": "Neste campo é necessário informar o token gerado na rota de autenticação.",
            "schema": {
              "type": "string",
              "default": "TOKEN_GERADO"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "200",
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
        "security": []
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