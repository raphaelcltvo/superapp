---
updatedAt: 2026-05-07T14:13:00.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Consultar o Cardápio

<br />

> 🚧 Observações
>
> O link tem validade de 30 minutos após a requisição a esse endpoint.
>
> O campo `codigo_saipos` é utilizado como código PDV para integração dos itens e opcionais.

**Formato do arquivo JSON baixado**\`\`

```json
[
  {
    "tipo": "PRATO",
    "categoria": "Pizzas",
    "tamanho": "Único",
    "id_store_item": 12606017,
    "item": "Pizza",
    "id_store_choice": null,
    "complemento": "",
    "complemento_item": "",
    "price": 0,
    "codigo_saipos": "12606018",
    "store_item_enabled": "Y",
    "store_choice_enabled": "Y",
    "store_choice_item_enabled": "Y",
    "item_type": "pizza",
    "min_choices": null,
    "max_choices": null,
    "calc_method": null,
    "print_by_quantity": null
  },
  {
    "tipo": "COMPLEMENTO",
    "categoria": "Pizzas",
    "tamanho": "Único",
    "id_store_item": 12606017,
    "item": "Pizza",
    "id_store_choice": 1293190,
    "complemento": "Sabores Pizza",
    "complemento_item": "queijo",
    "price": 10,
    "codigo_saipos": "12606018.12326242",
    "store_item_enabled": "Y",
    "store_choice_enabled": "Y",
    "store_choice_item_enabled": "Y",
    "item_type": "pizza",
    "min_choices": 1,
    "max_choices": 2,
    "calc_method": "Rateio proporcional a quantidade de itens selecionados",
    "print_by_quantity": "Exibir o sabor com a fração proporcional à quantidade"
  },
  {
    "tipo": "COMPLEMENTO",
    "categoria": "Pizzas",
    "tamanho": "Único",
    "id_store_item": 12606017,
    "item": "Pizza",
    "id_store_choice": 1293190,
    "complemento": "Sabores Pizza",
    "complemento_item": "calabresa",
    "price": 10,
    "codigo_saipos": "12606018.12326243",
    "store_item_enabled": "Y",
    "store_choice_enabled": "Y",
    "store_choice_item_enabled": "Y",
    "item_type": "pizza",
    "min_choices": 1,
    "max_choices": 2,
    "calc_method": "Rateio proporcional a quantidade de itens selecionados",
    "print_by_quantity": "Exibir o sabor com a fração proporcional à quantidade"
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
    "/v2/catalog": {
      "get": {
        "summary": "Consultar o Cardápio",
        "description": "",
        "operationId": "consultar-o-cardápio-copy",
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
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"url\": \"https://saipos-integration-services-catalog-production.s3.us-east-1.amazonaws.com/catalog/catalog-896.json?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIARKYKYDVYF37MFC2N%2F20240514%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20240514T201402Z&X-Amz-Expires=1800&X-Amz-Signature=4c4326a4b5c90c30aa0fd0b477c2f62dbf641f8c8597a2dd00e8967c525c7538&X-Amz-SignedHeaders=host&x-id=GetObject\"\n}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {
                    "url": {
                      "type": "string",
                      "example": "https://saipos-integration-services-catalog-production.s3.us-east-1.amazonaws.com/catalog/catalog-896.json?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIARKYKYDVYF37MFC2N%2F20240514%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20240514T201402Z&X-Amz-Expires=1800&X-Amz-Signature=4c4326a4b5c90c30aa0fd0b477c2f62dbf641f8c8597a2dd00e8967c525c7538&X-Amz-SignedHeaders=host&x-id=GetObject"
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