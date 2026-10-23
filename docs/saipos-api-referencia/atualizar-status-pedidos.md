---
updatedAt: 2026-05-07T14:10:30.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Atualizar status do pedido

É por meio deste endpoint será permitido atualizar os status dos pedidos enviados para o Sistema Saipos.

<br />

Permitir que qualquer parceiro integrado via API de Pedidos possa notificar a Saipos sobre eventos do pedido.

| Evento     | Descrição                                                                     | Comportamento esperado na Saipos                                                |
| :--------- | :---------------------------------------------------------------------------- | :------------------------------------------------------------------------------ |
| DISPATCHED | Indica que o pedido foi despachado pelo entregador e está em rota de entrega. | Atualizar o status do pedido para SAIU PARA ENTREGA no Kanban ( tag em entrega) |
| CONCLUDED  | Indica que o pedido foi entregue ao cliente final                             | Atualizar o status do pedido para FINALIZADO no Kanban (tag entregue)           |
| CANCELLED  | Indica que o pedido foi cancelado no parceiro                                 | Atualizar o status do pedido para CANCELADO no Kanban (tag cancelado)           |

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
    "/update-order-status": {
      "post": {
        "summary": "Atualizar status do pedido",
        "description": "É por meio deste endpoint será permitido atualizar os status dos pedidos enviados para o Sistema Saipos.",
        "operationId": "atualizar-status-pedidos",
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
                    "description": "ID do pedido que deseja atualizar"
                  },
                  "status": {
                    "type": "string",
                    "description": "Status a ser atualizado : “DISPATCHED”,”CONCLUDED”,”CANCELLED”"
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
                    "value": "{\n  \"code\": \"set-sale-partner-sale-status-success\",\n  \"idStore\": \"896\",\n  \"codSale1\": 114876,\n  \"statusToUpdate\": {\n    \"status\": \"CONCLUDED\"\n  },\n  \"update\": true,\n  \"confirmed_by\": \"SAIPOS\"\n}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {
                    "code": {
                      "type": "string",
                      "example": "set-sale-partner-sale-status-success"
                    },
                    "idStore": {
                      "type": "string",
                      "example": "896"
                    },
                    "codSale1": {
                      "type": "integer",
                      "example": 114876,
                      "default": 0
                    },
                    "statusToUpdate": {
                      "type": "object",
                      "properties": {
                        "status": {
                          "type": "string",
                          "example": "CONCLUDED"
                        }
                      }
                    },
                    "update": {
                      "type": "boolean",
                      "example": true,
                      "default": true
                    },
                    "confirmed_by": {
                      "type": "string",
                      "example": "SAIPOS"
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