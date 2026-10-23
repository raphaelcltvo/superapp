---
updatedAt: 2026-05-07T14:11:01.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Converter pedido manual em pedido de integração

Por meio deste endpoint é possível converter um pedido que foi criado de forma manual em um pedido de integração.

> 🚧 Importante
>
> Este recurso deve ser utilizado somente em casos onde é necessário adicionar itens a uma mesa ou comanda na qual o pedido não foi criado via integração
>
> Para pedidos manuais de Delivery não é possível realizar esta conversão

Ao realizar a conversão do pedido, será gerado o *order\_id* deste pedido convertido e a API retornará este **order\_id** junto com o número da mesa **table** e o número da comanda **pad** para que sejam utilizados na adição de novos itens conforme descrito em [Criar Pedido](https://saipos-docs-order-api.readme.io/reference/create-order)

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
    "/convert-orders-in-table": {
      "post": {
        "summary": "Converter pedido manual em pedido de integração",
        "description": "Por meio deste endpoint é possível converter um pedido que foi criado de forma manual em um pedido de integração.",
        "operationId": "converter-pedido-manual-em-pedido-integracao",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "table": {
                    "type": "string",
                    "description": "Número da mesa na Saipos"
                  }
                }
              },
              "examples": {
                "Request Example": {
                  "value": {
                    "table": "1"
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
                    "value": "{\n    \"order_ids\": [\n        {\n            \"order_id\": \"123456\",\n            \"table\": \"1\",\n            \"pad\": \"1\"\n        }\n    ]\n}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {
                    "order_ids": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "order_id": {
                            "type": "string",
                            "example": "123456"
                          },
                          "table": {
                            "type": "string",
                            "example": "1"
                          },
                          "pad": {
                            "type": "string",
                            "example": "1"
                          }
                        }
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