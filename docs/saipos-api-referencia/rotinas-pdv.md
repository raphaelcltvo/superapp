---
updatedAt: 2026-03-02T22:20:26.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Rotinas no PDV

## Exportação de códigos PDVs

Para realizar a exportação dos códigos PDVs do cardápio da loja, basta acessar o **menu > Cardápio>Códigos de Integração** e clicar para exportar e selecionar o tipo de importação

#### Passo 1

![](https://files.readme.io/bff41da9c8ba256fb54f5753b2bab361de845fa36d86ede99883beef7b89a74f-image.png)

#### Passo 2

<Image align="center" border={true} src="https://files.readme.io/19aede4d624ae50b517cc046f57df9b6c7718b887e3d055ee0b3f676730f75ec-image.png" className="border" />

#### Passo 3

<Image align="center" border={true} src="https://files.readme.io/123e97662cbf734e55ec83c9998912b7af31337067dd38e339a8ef1ea1b49602-image.png" className="border" />

#### Passo 4

<Image align="center" border={true} src="https://files.readme.io/d279d09483d610d7eb0bbfff2969232a198be22bf1caa6505cf82c5073c7e0b0-image.png" className="border" />

## Cadastro de formas de pagamento

Ao acessar o menu e ir em **Canais de venda e integrações**, você deve buscar a integração com o seu aplicativo e após, clicar em **Configurar**

![](https://files.readme.io/df5d59a7ffb35c0402724e184284a7732841f981a2b23a188a3f215344d53d99-image.png)

<br />

As formas de pagamento que não usam complemento devem ficar com o campo de mesmo nome vazio. Desta forma o sistema irá selecionar elas no momento de importar o pedido. Já se deseja especificar a forma de pagamento, você deve inserir no campo complemento o mesmo valor que irá vir no campo complement no json.

<Image align="center" border={true} src="https://files.readme.io/3b49c35-image_1.png" title="image (1).png" className="border" />

Caso a forma de pagamento tenha o campo de "PGTO ONLINE" marcado, deve ser enviado o campo "type" com o valor "ONLINE".

**Exemplo**:

```json
{
    ...
    "payment_types":[{   
        "code":"CRE", 
        "amount":3,
        "change_for":0,
        "complement": "Visa",
        "type": "ONLINE"
    },{   
        "code":"DEB", 
        "amount":3,
        "change_for":0,
        "complement": "Mastercard",
        "type": "OFFLINE"
    }] 
    ...
}
´´´

 
```

## Transferência de pedidos de mesa

Para transferir um pedido de uma mesa para outra, você precisará apenas enviar o pedido completo para a nova mesa.

<Callout icon="🚧" theme="warn">
  A transferência de pedidos de mesa é somente feita de forma completa, ou seja, o sistema não aceita transferir os itens de pedidos de mesa integrados pela API Pública (portanto, não é possível efetuar a transferência parcial de itens).
</Callout>

Para acessar essa opção, selecione a mesa que queira realizar a troca, clique na opção **Transferir itens**, que será aberto uma modal conforme imagem abaixo, contendo a opção **TROCAR MESA**

![](https://files.readme.io/d651e9497d8c377dd96b032afaee8df8b26406e7d0bcdb1b1346e453d1b7d269-image.png)