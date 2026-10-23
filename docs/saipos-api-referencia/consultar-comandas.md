---
updatedAt: 2026-05-07T14:09:32.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Consultar comandas

## Response

### Sucesso — `200 OK`

| Campo                    | Tipo           | Descrição                                                                                 |
| ------------------------ | -------------- | ----------------------------------------------------------------------------------------- |
| `pad_mode`               | String         | Modo de operação das comandas. Valores possíveis: `MANUAL`, `AUTO`. Ver descrição abaixo. |
| `pads`                   | Array          | Lista de comandas cadastradas na loja.                                                    |
| `pads[].order_card`      | String         | Identificador de exibição da comanda (`display_order_card`).                              |
| `pads[].enabled`         | String/Boolean | Indica se a comanda está habilitada.                                                      |
| `pads[].have_open_sales` | String         | Indica se a comanda possui vendas abertas. Valores: `"Y"` (sim) ou `"N"` (não).           |

**Descrição do `pad_mode`:**

| Valor    | Descrição                                                                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MANUAL` | O parceiro define qual comanda será utilizada na criação do pedido. A comanda enviada na requisição é respeitada.                                                                      |
| `AUTO`   | A loja está configurada para atribuição automática de comandas. A próxima comanda livre disponível será utilizada na criação do pedido, independente da comanda enviada pelo parceiro. |

**Exemplo de resposta:**

```json
{
  "pad_mode": "AUTO",
  "pads": [
    {
      "order_card": "001",
      "enabled": true,
      "have_open_sales": "N"
    },
    {
      "order_card": "002",
      "enabled": true,
      "have_open_sales": "S"
    },
    {
      "order_card": "003",
      "enabled": false,
      "have_open_sales": "N"
    }
  ]
}
```

## Erros

Todos os erros seguem o formato abaixo:

```json
{
  "type": "order-cards",
  "errorCode": 901,
  "dateTime": "2026-04-08T12:00:00.000Z",
  "errorMessage": "Token inválido ou expirado.",
  "guidRequest": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

| HTTP Status | `errorCode` | `errorMessage`                                                                                                        | Quando acontece                                                                         |
| ----------- | ----------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `401`       | `901`       | Token inválido ou expirado.                                                                                           | O header `Authorization` está ausente, malformado ou o token JWT foi expirado/revogado. |
| `400`       | `917`       | A integração está com o token inválido. Para recriar o token é necessário que o canal de venda integração seja salvo. | A API interna da Saipos retornou `401`. O token de acesso geral da loja expirou.        |
| `404`       | `946`       | Restaurante não possui comandas cadastradas.                                                                          | A loja não tem nenhuma comanda cadastrada ou ativa.                                     |
| `500`       | `900`       | Erro interno, comunique o time técnico.                                                                               | Falha inesperada durante o processamento. Entrar em contato com o suporte.              |

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
    "/order-cards": {
      "get": {
        "description": "",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [
          {
            "in": "header",
            "name": "Authorization",
            "schema": {
              "type": "string"
            },
            "required": true
          }
        ],
        "operationId": "get_order-cards",
        "summary": "Consultar comandas"
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