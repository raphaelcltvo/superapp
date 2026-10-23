---
updatedAt: 2026-05-07T14:12:48.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Consultar garçons

Por meio deste endpoint é possível consultar os garçons cadastrados na loja.

<br />

É possível consultar os garçons cadastrados na loja por este Endpoint.

## Exemplo de JSON da consulta de garçons

```json
[
    {
        "id_store_waiter": 85,
        "desc_store_waiter": "Garçom 1",
        "enabled": "Y",
        "digital_menu": "N"
    },
    {
        "id_store_waiter": 86,
        "desc_store_waiter": "Garçom 2",
        "enabled": "Y",
        "digital_menu": "N"
    },
    {
        "id_store_waiter": 2913,
        "desc_store_waiter": "Garçom 3",
        "enabled": "Y",
        "digital_menu": "Y"
    }
]
```

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
    "/waiters": {
      "get": {
        "summary": "Consultar garçons",
        "description": "Por meio deste endpoint é possível consultar os garçons cadastrados na loja.",
        "operationId": "consultar-garcons",
        "parameters": [
          {
            "name": "Authorization",
            "in": "header",
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
                    "value": "[\n    {\n        \"table\": \"20\",\n        \"pad\": \"45\",\n        \"order_id\": \"1678716468\",\n        \"id_partner_sale\": 28,\n        \"id_table_order_status\": 2\n    }\n]"
                  }
                },
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "table": {
                        "type": "string",
                        "example": "20"
                      },
                      "pad": {
                        "type": "string",
                        "example": "45"
                      },
                      "order_id": {
                        "type": "string",
                        "example": "1678716468"
                      },
                      "id_partner_sale": {
                        "type": "integer",
                        "example": 28,
                        "default": 0
                      },
                      "id_table_order_status": {
                        "type": "integer",
                        "example": 2,
                        "default": 0
                      }
                    }
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
        "deprecated": false,
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