---
updatedAt: 2026-03-02T20:51:32.000Z
agentTools:
  projectIndex: https://saipos-docs-order-api.readme.io/llms.txt
---

# Dúvidas frequentes

Nesta seção, você encontra as respostas para as dúvidas mais comuns sobre o uso da API de Pedidos

<Accordion title="Quanto tempo o token de autenticação gerado pela rota _/auth_ fica válido?" icon="fa-info-circle">
  O token possui validade de 2 dias tanto em produção quanto em homologação
</Accordion>

<Accordion title="O que a API de Pedidos suporta atualmente?" icon="fa-info-circle">
  Nossa API de Pedidos é destinada ao envio de novos pedidos de plataformas parceiras para serem importados para a SAIPOS. Atualmente, o principal *endpoint* de consulta disponível é o de catálogo.
</Accordion>

<Accordion title="Posso utilizar o endpoint de Consulta de Pedidos para realizar o serviço de logística?" icon="fa-info-circle">
  O endpoint de Consulta de Pedidos não retorna o endereço, ele é voltado para pedidos que não necessitam de entrega.
</Accordion>