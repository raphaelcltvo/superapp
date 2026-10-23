---
updatedAt: 2026-05-07T14:12:37.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Transferência de pedidos de mesa

É através deste endpoint que será realizada a troca de pedidos entre mesas.

<br />

Para transferir um pedido de uma mesa para outra, basta enviar o *order\_id* e a *table* para a qual o pedido será movido.

**NOTA**: A transferência de pedidos de mesa é somente feita de forma completa, ou seja, o sistema não aceita transferir os itens de forma parcial.

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
    "/change-table": {
      "put": {
        "summary": "Transferência de pedidos de mesa",
        "description": "É através deste endpoint que será realizada a troca de pedidos entre mesas.",
        "operationId": "transferencia-pedido-mesa",
        "parameters": [
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
                  "table": {
                    "type": "string"
                  }
                }
              },
              "examples": {
                "example": {
                  "value": {
                    "order_id": "1689003781",
                    "table": 48
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
                    "value": "{\n    \"changed\": true\n}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {
                    "changed": {
                      "type": "boolean",
                      "example": true,
                      "default": true
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
                  "Não Existe pedido com este identificador": {
                    "value": "{\n    \"t\": \"sale\",\n    \"dateTime\": \"2021-12-24T13:35:05.577Z\",\n    \"errorMessage\": \"Não existe pedido com esse identificador.\",\n    \"guidRequest\": \"40757446-73b4-4995-b802-dcce4741146e\"\n}"
                  },
                  "Pedido deve ser do tipo mesa ou mesa/comanda": {
                    "value": "{\n    \"t\": \"sale\",\n    \"dateTime\": \"2021-12-24T13:35:05.577Z\",\n    \"errorMessage\": \"Pedido deve ser do tipo mesa ou mesa/comanda.\",\n    \"guidRequest\": \"40757446-73b4-4995-b802-dcce4741146e\"\n}"
                  },
                  "Venda já aberta nesta mesa, selecione outra ou use a transferência de itens": {
                    "value": "{\n    \"t\": \"sale\",\n    \"dateTime\": \"2021-12-24T13:35:05.577Z\",\n    \"errorMessage\": \"Venda já aberta nesta mesa, selecione outra ou use a transferência de itens.\",\n    \"guidRequest\": \"40757446-73b4-4995-b802-dcce4741146e\"\n}"
                  },
                  "Mesa inexistente": {
                    "value": "{\n    \"t\": \"sale\",\n    \"dateTime\": \"2021-12-24T13:35:05.577Z\",\n    \"errorMessage\": \"Esta mesa não existe.\",\n    \"guidRequest\": \"40757446-73b4-4995-b802-dcce4741146e\"\n}"
                  }
                },
                "schema": {
                  "oneOf": [
                    {
                      "title": "Não Existe pedido com este identificador",
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
                    },
                    {
                      "title": "Pedido deve ser do tipo mesa ou mesa/comanda",
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
                          "example": "Pedido deve ser do tipo mesa ou mesa/comanda."
                        },
                        "guidRequest": {
                          "type": "string",
                          "example": "40757446-73b4-4995-b802-dcce4741146e"
                        }
                      }
                    },
                    {
                      "title": "Venda já aberta nesta mesa, selecione outra ou use a transferência de itens",
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
                          "example": "Venda já aberta nesta mesa, selecione outra ou use a transferência de itens."
                        },
                        "guidRequest": {
                          "type": "string",
                          "example": "40757446-73b4-4995-b802-dcce4741146e"
                        }
                      }
                    },
                    {
                      "title": "Mesa inexistente",
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
                          "example": "Esta mesa não existe."
                        },
                        "guidRequest": {
                          "type": "string",
                          "example": "40757446-73b4-4995-b802-dcce4741146e"
                        }
                      }
                    }
                  ]
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