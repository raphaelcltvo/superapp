---
updatedAt: 2026-05-07T14:09:32.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Consultar status de uma comanda

## Response

### Sucesso — `200 OK`

| Campo        | Tipo   | Descrição                                                                          |
| ------------ | ------ | ---------------------------------------------------------------------------------- |
| `order_card` | String | Identificador de exibição da comanda consultada.                                   |
| `status`     | String | Status atual da comanda. Valores possíveis: `OPEN`, `IN_USE`, `CLOSING_REQUESTED`. |

**Descrição dos status:**

| Status              | Descrição                                        |
| ------------------- | ------------------------------------------------ |
| `OPEN`              | Comanda disponível para uso (sem venda aberta).  |
| `IN_USE`            | Comanda em uso com venda em andamento.           |
| `CLOSING_REQUESTED` | Solicitação de fechamento da venda em andamento. |

**Exemplo de resposta — comanda livre:**

```json
{
  "order_card": "001",
  "status": "OPEN"
}
```

**Exemplo de resposta — comanda em uso:**

```json
{
  "order_card": "002",
  "status": "IN_USE"
}
```

**Exemplo de resposta — comanda em fechamento:**

```json
{
  "order_card": "003",
  "status": "CLOSING_REQUESTED"
}
```

## Erros

Todos os erros seguem o formato abaixo:

```json
{
  "type": "order-card-status",
  "errorCode": 910,
  "dateTime": "2026-04-08T12:00:00.000Z",
  "errorMessage": "A loja não possui comanda com esse identificador!",
  "guidRequest": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

| HTTP Status | `errorCode` | `errorMessage`                                                                                                        | Quando acontece                                                                         |
| ----------- | ----------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `401`       | `901`       | Token inválido ou expirado.                                                                                           | O header `Authorization` está ausente, malformado ou o token JWT foi expirado/revogado. |
| `400`       | `917`       | A integração está com o token inválido. Para recriar o token é necessário que o canal de venda integração seja salvo. | A API interna da Saipos retornou `401`. O token de acesso geral da loja expirou.        |
| `404`       | `946`       | Restaurante não possui comandas cadastradas.                                                                          | A loja não tem nenhuma comanda cadastrada ou ativa.                                     |
| `404`       | `910`       | A loja não possui comanda com esse identificador!                                                                     | O valor informado em `order_card` não corresponde a nenhuma comanda cadastrada na loja. |
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
    "/order-card-status": {
      "get": {
        "description": "",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [
          {
            "in": "query",
            "name": "order_card",
            "schema": {
              "type": "string"
            },
            "required": true,
            "description": "Identificador de exibição da comanda (display_order_card)"
          },
          {
            "in": "header",
            "name": "Authorization",
            "schema": {
              "type": "string"
            },
            "required": true
          }
        ],
        "operationId": "get_order-card-status",
        "summary": "Consultar status de uma comanda"
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