from rest_framework.pagination import PageNumberPagination


class Pagination(PageNumberPagination):
    """По 50 записей на страницу, но клиент может попросить больше: ?page_size=.

    Раньше стоял стандартный класс, у которого этого параметра нет: интерфейс
    просил page_size=200, а получал 50, и любой список молча обрезался, как
    только записей становилось больше. Пока договоров было 29, это не всплывало.
    """
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 5000
