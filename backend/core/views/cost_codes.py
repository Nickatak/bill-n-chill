from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import CostCode
from core.serializers import CostCodeSerializer


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def cost_codes_list_create_view(request):
    if request.method == "GET":
        rows = CostCode.objects.filter(created_by=request.user).order_by("code", "name")
        return Response({"data": CostCodeSerializer(rows, many=True).data})

    serializer = CostCodeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    code = serializer.save(created_by=request.user)
    return Response({"data": CostCodeSerializer(code).data}, status=201)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def cost_code_detail_view(request, cost_code_id: int):
    try:
        row = CostCode.objects.get(id=cost_code_id, created_by=request.user)
    except CostCode.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Cost code not found.", "fields": {}}},
            status=404,
        )

    serializer = CostCodeSerializer(row, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response({"data": CostCodeSerializer(row).data})
