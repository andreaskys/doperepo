package notifications

import "fmt"

type MailData struct {
	RecipientName string
	VenueTitle    string
	StartDate     string // "2006-01-02"
	EndDate       string
	TotalPrice    string
}

// renderMail devolve assunto + corpo (texto puro PT-BR) por tipo de evento.
func renderMail(t EventType, d MailData) (subject, body string) {
	switch t {
	case BookingRequested:
		subject = "Nova solicitação de reserva"
		body = fmt.Sprintf("Olá %s,\n\nVocê recebeu uma solicitação de reserva para %q.\nDatas: %s → %s · Total: R$ %s.\n\nConfirme ou recuse em \"Reservas recebidas\".\n\n— Espaços",
			d.RecipientName, d.VenueTitle, d.StartDate, d.EndDate, d.TotalPrice)
	case BookingConfirmed:
		subject = "Sua reserva foi confirmada"
		body = fmt.Sprintf("Olá %s,\n\nSua reserva em %q foi confirmada.\nDatas: %s → %s · Total: R$ %s.\n\n— Espaços",
			d.RecipientName, d.VenueTitle, d.StartDate, d.EndDate, d.TotalPrice)
	case BookingCancelled:
		subject = "Reserva cancelada"
		body = fmt.Sprintf("Olá %s,\n\nA reserva em %q foi cancelada.\nDatas: %s → %s.\n\n— Espaços",
			d.RecipientName, d.VenueTitle, d.StartDate, d.EndDate)
	default:
		subject = "Atualização da sua reserva"
		body = fmt.Sprintf("Olá %s,\n\nHouve uma atualização na sua reserva em %q.\n\n— Espaços",
			d.RecipientName, d.VenueTitle)
	}
	return subject, body
}
