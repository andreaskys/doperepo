package rabbitmq

import (
	"context"
	"fmt"

	amqp "github.com/rabbitmq/amqp091-go"
)

// NotificationsQueue é a fila inicial para processamento assíncrono (e-mails,
// notificações de reserva). Outras filas entram conforme a necessidade.
const NotificationsQueue = "notifications"

// Publisher é a fundação de mensageria: detém a conexão + canal e declara as
// filas. Os use cases injetam isso e chamam Publish para enfileirar trabalho.
type Publisher struct {
	conn *amqp.Connection
	ch   *amqp.Channel
}

func New(url string) (*Publisher, error) {
	conn, err := amqp.Dial(url)
	if err != nil {
		return nil, fmt.Errorf("dial rabbitmq: %w", err)
	}
	ch, err := conn.Channel()
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("abrir canal: %w", err)
	}
	// durable=true: a fila sobrevive a restart do broker.
	if _, err := ch.QueueDeclare(NotificationsQueue, true, false, false, false, nil); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("declarar fila: %w", err)
	}
	return &Publisher{conn: conn, ch: ch}, nil
}

// Publish envia uma mensagem persistente para uma fila. body são bytes crus
// (JSON na prática).
func (p *Publisher) Publish(ctx context.Context, queue string, body []byte) error {
	return p.ch.PublishWithContext(ctx, "", queue, false, false, amqp.Publishing{
		ContentType:  "application/json",
		Body:         body,
		DeliveryMode: amqp.Persistent,
	})
}

// Consume abre um canal PRÓPRIO (o canal de publish não é goroutine-safe) e
// entrega as mensagens da fila com ack manual.
func (p *Publisher) Consume(queue string) (<-chan amqp.Delivery, error) {
	ch, err := p.conn.Channel()
	if err != nil {
		return nil, err
	}
	return ch.Consume(queue, "", false, false, false, false, nil)
}

func (p *Publisher) Close() {
	if p.ch != nil {
		_ = p.ch.Close()
	}
	if p.conn != nil {
		_ = p.conn.Close()
	}
}
