from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.models import UserAvatar
from authentication.profiles.utils import avatar_url


class AvatarHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        current_avatar_name = user.avatar.name if user.avatar else ""
        avatars = user.avatar_history.all()
        return Response({
            "avatars": [
                {
                    "id": avatar.id,
                    "url": avatar_url(avatar.image),
                    "is_current": avatar.image.name == current_avatar_name,
                    "created_at": avatar.created_at,
                }
                for avatar in avatars
            ]
        }, status=status.HTTP_200_OK)


class AvatarSelectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, avatar_id):
        avatar = UserAvatar.objects.filter(id=avatar_id, user=request.user).first()
        if not avatar:
            return Response({"error": "Avatar not found."}, status=status.HTTP_404_NOT_FOUND)

        request.user.avatar = avatar.image.name
        request.user.save(update_fields=["avatar"])

        return Response({"message": "Avatar selected successfully."}, status=status.HTTP_200_OK)
