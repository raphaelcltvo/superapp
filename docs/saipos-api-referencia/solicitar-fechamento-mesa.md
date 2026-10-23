---
updatedAt: 2026-05-07T14:12:15.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Solicitar fechamento da mesa

É através deste endpoint que será notificado dentro da tela de meses no Sistema Saipos que o cliente deseja realizar o fechamento.

<br />

O modo de fechamento de mesa está disponível somente para pedidos de *mesa*.

Ao solicitar o fechamento, a mesa será marcada em laranja na tela de mesas, indicando ao garçom que deve ir até o cliente para realizar o fechamento.

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
    "/close-sale": {
      "put": {
        "summary": "Solicitar fechamento da mesa",
        "description": "É através deste endpoint que será notificado dentro da tela de meses no Sistema Saipos que o cliente deseja realizar o fechamento.",
        "operationId": "solicitar-fechamento-mesa",
        "parameters": [
          {
            "name": "cod_store",
            "in": "query",
            "schema": {
              "type": "string",
              "default": "123"
            }
          },
          {
            "name": "order_id",
            "in": "query",
            "schema": {
              "type": "string",
              "default": "123"
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
                    "type": "string"
                  },
                  "cod_store": {
                    "type": "string"
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
                    "value": "{\n    \"customer\": \"PEDIDO DE TESTE - Jonathan Stein\",\n    \"created_at\": \"2020-10-08T01:25:49.000Z\",\n    \"notes\": \"\",\n    \"totalDiscount\": 0,\n    \"totalIncrease\": 0,\n    \"discountReason\": \"\",\n    \"increaseReason\": \"\",\n    \"totalValue\": 14.3,\n    \"totalItems\": 13,\n    \"serviceFee\": 10,\n    \"items\": [\n        {\n            \"desc_sale_item\": \"PEDIDO DE TESTE - PEQUENO\",\n            \"quantity\": 1,\n            \"unit_price\": 13,\n            \"choice_items\": [\n                {\n                    \"desc_sale_item_choice\": \"Massa massa doce + Borda normal\",\n                    \"aditional_price\": 3\n                },\n                {\n                    \"desc_sale_item_choice\": \"Queijo\",\n                    \"aditional_price\": 10\n                }\n            ]\n        }\n    ]\n}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {
                    "customer": {
                      "type": "string",
                      "example": "PEDIDO DE TESTE - Jonathan Stein"
                    },
                    "created_at": {
                      "type": "string",
                      "example": "2020-10-08T01:25:49.000Z"
                    },
                    "notes": {
                      "type": "string",
                      "example": ""
                    },
                    "totalDiscount": {
                      "type": "integer",
                      "example": 0,
                      "default": 0
                    },
                    "totalIncrease": {
                      "type": "integer",
                      "example": 0,
                      "default": 0
                    },
                    "discountReason": {
                      "type": "string",
                      "example": ""
                    },
                    "increaseReason": {
                      "type": "string",
                      "example": ""
                    },
                    "totalValue": {
                      "type": "number",
                      "example": 14.3,
                      "default": 0
                    },
                    "totalItems": {
                      "type": "integer",
                      "example": 13,
                      "default": 0
                    },
                    "serviceFee": {
                      "type": "integer",
                      "example": 10,
                      "default": 0
                    },
                    "items": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "desc_sale_item": {
                            "type": "string",
                            "example": "PEDIDO DE TESTE - PEQUENO"
                          },
                          "quantity": {
                            "type": "integer",
                            "example": 1,
                            "default": 0
                          },
                          "unit_price": {
                            "type": "integer",
                            "example": 13,
                            "default": 0
                          },
                          "choice_items": {
                            "type": "array",
                            "items": {
                              "type": "object",
                              "properties": {
                                "desc_sale_item_choice": {
                                  "type": "string",
                                  "example": "Massa massa doce + Borda normal"
                                },
                                "aditional_price": {
                                  "type": "integer",
                                  "example": 3,
                                  "default": 0
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "404",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n    \"t\": \"sale\",\n    \"dateTime\": \"2021-12-24T13:35:05.577Z\",\n    \"errorMessage\": \"Não existe pedido com esse identificador.\",\n    \"guidRequest\": \"40757446-73b4-4995-b802-dcce4741146e\"\n}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {
                    "t": {
                      "type": "string",
                      "example": "sale"
                    },
                    "dateTime": {
                      "type": "string",
                      "example": "2021-12-24T13:35:05.577Z"
                    },
                    "errorMessage": {
                      "type": "string",
                      "example": "Não existe pedido com esse identificador."
                    },
                    "guidRequest": {
                      "type": "string",
                      "example": "40757446-73b4-4995-b802-dcce4741146e"
                    }
                  }
                }
              }
            }
          },
          "500": {
            "description": "500",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n    \"t\": \"sale\",\n    \"dateTime\": \"2021-12-24T13:35:41.780Z\",\n    \"errorMessage\": \"Erro interno, comunique o time técnico.\",\n    \"guidRequest\": \"7d99d6ea-371b-48f7-9eeb-a48b57467615\"\n}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {
                    "t": {
                      "type": "string",
                      "example": "sale"
                    },
                    "dateTime": {
                      "type": "string",
                      "example": "2021-12-24T13:35:41.780Z"
                    },
                    "errorMessage": {
                      "type": "string",
                      "example": "Erro interno, comunique o time técnico."
                    },
                    "guidRequest": {
                      "type": "string",
                      "example": "7d99d6ea-371b-48f7-9eeb-a48b57467615"
                    }
                  }
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