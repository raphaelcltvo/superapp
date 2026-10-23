---
updatedAt: 2026-05-07T14:11:46.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Consultar por mesa ou comanda

Por meio deste endpoint é possível consultar a situação de pedidos de Mesas e Comandas.

<br />

É possível consultar a situação dos pedidos de mesas e comandas por este Endpoint.

> 🚧 Observação
>
> Pedidos que são feitos manuais pela Saipos não possuem order\_id.

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
    "/sale-status-by-table-or-pad": {
      "get": {
        "summary": "Consultar por mesa ou comanda",
        "description": "Por meio deste endpoint é possível consultar a situação de pedidos de Mesas e Comandas.",
        "operationId": "consulta-por-mesas-ou-comandas",
        "parameters": [
          {
            "name": "pad",
            "in": "query",
            "description": "Comandas a serem pesquisadas",
            "schema": {
              "type": "string",
              "default": "[123]"
            }
          },
          {
            "name": "table",
            "in": "query",
            "description": "Mesas a serem pesquisadas",
            "schema": {
              "type": "string",
              "default": "[5]"
            }
          },
          {
            "name": "Authorization",
            "in": "header",
            "schema": {
              "type": "string"
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